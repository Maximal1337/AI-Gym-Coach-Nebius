import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { ApiError } from '../../src/lib/api';
import {
  ASSISTANT_REPLY_NOTIFICATION, fetchLatestMessages, fetchMessagesSince, fetchOpenJobs, sendAssistantMessage,
  setAssistantChatFocused,
} from '../../src/lib/assistant';
import {
  buildItems, classifySendFailure, failedMessageIds, MAX_ASSISTANT_MESSAGE, mergeRows, pruneLocal, replyStatus, shouldPoll,
  sourceLabel,
  type AssistantRow, type ChatItem, type LocalSend, type OpenJob, type SendFailure,
} from '../../src/lib/assistantLogic';
import { generateMessageId } from '../../src/lib/messages';
import { useFlag } from '../../src/lib/flags';
import { useLanguage } from '../../src/lib/language';
import { track } from '../../src/lib/analytics';
import { Screen } from '../../src/components/Screen';
import { MarkdownText } from '../../src/components/MarkdownText';
import { IconButton } from '../../src/components/IconButton';
import { useTheme, spacing, radius, typography, TAB_BAR_CLEARANCE } from '../../src/theme';

const POLL_MS = 3000;

/** The notice a refused send leaves above the composer (the message itself goes back into it). */
const FAILURE_NOTICE: Record<Exclude<SendFailure, 'retry'>, string> = {
  subscription: 'trialExpired',
  assistantOff: 'assistantOff',
  slowDown: 'assistantSlowDown',
  dailyLimit: 'assistantDailyLimit',
  busyToday: 'assistantBusyToday',
  tooLong: 'assistantTooLong',
  signedOut: 'assistantSignedOut',
};

/**
 * The coach assistant chat (NH-70): the always-on coach outside workouts —
 * Hermes in the user's own sandbox, with web search, memory and plan tools.
 * Only accounts with the assistant_chat flag see this tab.
 *
 * Asynchronous, unlike the workout chat: a send is queued (assistant-send)
 * and the reply lands in assistant_messages later, with a push. The screen
 * catches up on focus, on returning to the foreground, on a reply's push,
 * and by polling every few seconds only while a reply is expected.
 */
export default function CoachAssistant() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const enabled = useFlag('assistant_chat');
  const memoryEnabled = useFlag('assistant_memory');
  const [rows, setRows] = useState<AssistantRow[]>([]);
  const [local, setLocal] = useState<LocalSend[]>([]);
  const [jobs, setJobs] = useState<OpenJob[]>([]);
  // Failed messages already sent again — their "send again" is gone.
  const [resent, setResent] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const list = useRef<FlatList<ChatItem>>(null);
  const rowsRef = useRef<AssistantRow[]>([]);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  // The first fill jumps to the bottom; later messages scroll there smoothly.
  const scrolledOnce = useRef(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // One refresh at a time; a request that comes in meanwhile (a push, a poll)
  // runs once more right after, so nothing is dropped. Job statuses are read
  // before messages: a job that reads as done already has its reply stored
  // (assistant_complete_job does both in one transaction), so the message
  // read that follows can't miss it.
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    try {
      const open = await fetchOpenJobs();
      const last = rowsRef.current.at(-1)?.created_at;
      const incoming = last ? await fetchMessagesSince(last) : await fetchLatestMessages();
      const merged = mergeRows(rowsRef.current, incoming);
      rowsRef.current = merged;
      setRows(merged);
      setLocal((l) => pruneLocal(l, merged));
      setJobs(open);
      setLoadFailed(false);
    } catch {
      // Keep what's on screen; the next focus, push or poll tries again.
      if (rowsRef.current.length === 0) setLoadFailed(true);
    } finally {
      setNow(Date.now());
      setLoaded(true);
      refreshing.current = false;
      if (refreshAgain.current) {
        refreshAgain.current = false;
        void refresh();
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setAssistantChatFocused(true);
      void refresh();
      return () => {
        setFocused(false);
        setAssistantChatFocused(false);
      };
    }, [refresh]),
  );

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const received = Notifications.addNotificationReceivedListener((n) => {
      if (n.request.content.data?.type === ASSISTANT_REPLY_NOTIFICATION) void refresh();
    });
    return () => {
      appState.remove();
      received.remove();
    };
  }, [refresh]);

  const status = replyStatus(jobs, rows, now);
  const polling = focused && shouldPoll(status, local);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const failedIds = useMemo(() => failedMessageIds(jobs, rows, resent), [jobs, rows, resent]);
  const items = useMemo(() => buildItems(rows, local, failedIds), [rows, local, failedIds]);

  async function send(text: string, clientMessageId: string = generateMessageId()) {
    setNotice(null);
    setLocal((l) => [...l.filter((x) => x.clientMessageId !== clientMessageId), { clientMessageId, text, state: 'sending' }]);
    try {
      await sendAssistantMessage(text, clientMessageId);
      track('assistant_message_sent');
      await refresh();
    } catch (e) {
      const failure = e instanceof ApiError
        ? classifySendFailure(e.status, e.code, e.body.reason)
        : classifySendFailure(null, null);
      if (failure === 'retry') {
        // Network or server trouble: keep it, marked unsent — a tap resends it
        // with the same client id, which the server never stores twice.
        setLocal((l) => l.map((x) => (x.clientMessageId === clientMessageId ? { ...x, state: 'unsent' } : x)));
        return;
      }
      // A refusal: the message goes back into the composer, with the reason.
      track('assistant_message_refused', { reason: failure });
      setLocal((l) => l.filter((x) => x.clientMessageId !== clientMessageId));
      setDraft((d) => (d.trim() ? d : text));
      setNotice(FAILURE_NOTICE[failure]);
      if (failure === 'subscription') router.push('/subscribe');
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send(text);
  }

  function sendAgain(item: Extract<ChatItem, { from: 'me' }>) {
    track('assistant_send_again_tapped');
    if (item.rowId) setResent((s) => new Set(s).add(item.rowId!));
    void send(item.text);
  }

  const textAlign = (dir === 'rtl' ? 'right' : 'left') as 'right' | 'left';
  const rowDir = dir === 'rtl' ? 'row-reverse' : 'row';

  function renderItem({ item }: { item: ChatItem }) {
    const messageStyle = {
      color: item.from === 'me' ? theme.onAccent : theme.ink,
      fontSize: typography.message.size,
      lineHeight: typography.message.lineHeight,
      textAlign,
    };
    if (item.from === 'coach') {
      return (
        <View style={{ alignItems: 'flex-end' }}>
          {item.checkin && (
            <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Ionicons name="sunny-outline" size={13} color={theme.inkSoft} />
              <Text style={{ color: theme.inkSoft, fontSize: typography.meta.size, fontWeight: '700' }}>{t('assistantCheckin')}</Text>
            </View>
          )}
          <View style={{ maxWidth: '82%', backgroundColor: theme.surface, borderRadius: radius.bubble, padding: 12 }}>
            <MarkdownText style={messageStyle}>{item.text}</MarkdownText>
            {item.sources.length > 0 && (
              <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: theme.rule, gap: 6 }}>
                <Text style={{ color: theme.inkSoft, fontSize: typography.meta.size, fontWeight: '700', textAlign }}>
                  {t('assistantSources')}
                </Text>
                {item.sources.map((s) => (
                  <Pressable
                    key={s.url}
                    accessibilityRole="link"
                    onPress={() => { track('assistant_source_tapped'); void Linking.openURL(s.url); }}
                    style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}
                  >
                    <Ionicons name="link-outline" size={14} color={theme.accent} />
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.accent, fontSize: 13, textAlign }}>
                      {sourceLabel(s)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    }
    return (
      <View style={{ alignItems: 'flex-start' }}>
        <Pressable
          disabled={item.state !== 'unsent'}
          onPress={() => { track('assistant_retry_tapped'); void send(item.text, item.clientMessageId!); }}
          style={{
            maxWidth: '82%', backgroundColor: theme.accent, borderRadius: radius.bubble, padding: 12,
            opacity: item.state === 'sending' || item.state === 'unsent' ? 0.6 : 1,
          }}
        >
          <Text style={messageStyle}>{item.text}</Text>
        </Pressable>
        {item.state === 'unsent' && (
          <Text style={{ color: theme.critical, fontSize: typography.meta.size, marginTop: 4, textAlign }}>
            {t('assistantUnsent')}
          </Text>
        )}
        {item.state === 'no_reply' && (
          <View style={{ flexDirection: rowDir, alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
            <Text style={{ color: theme.inkSoft, fontSize: typography.meta.size }}>{t('assistantNoReply')}</Text>
            <Pressable hitSlop={8} onPress={() => sendAgain(item)}>
              <Text style={{ color: theme.accent, fontSize: typography.meta.size, fontWeight: '700' }}>{t('assistantSendAgain')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const statusLabel = status === 'typing' ? t('typing')
    : status === 'queued' ? t('assistantQueued')
    : status === 'slow' ? t('assistantSlow')
    : null;

  return (
    <Screen>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{
        flexDirection: rowDir, alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}>
        <View style={{ flex: 1, alignItems: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 16, textAlign }}>{t('assistantTitle')}</Text>
          <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign }} numberOfLines={1}>{t('assistantSubtitle')}</Text>
        </View>
        {enabled && memoryEnabled && (
          <IconButton
            name="bulb-outline"
            label={t('memoryTitle')}
            size={21}
            onPress={() => { track('assistant_memory_tapped'); router.push('/coach-memory'); }}
          />
        )}
      </View>

      {!enabled ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
          <Text style={{ color: theme.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>{t('assistantUnavailable')}</Text>
        </View>
      ) : (
        <>
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderItem}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
            onContentSizeChange={() => {
              list.current?.scrollToEnd({ animated: scrolledOnce.current });
              if (items.length > 0) scrolledOnce.current = true;
            }}
            ListEmptyComponent={
              loaded ? (
                <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.md }}>
                  <Ionicons name="sparkles-outline" size={28} color={theme.accent} style={{ alignSelf: 'center', marginBottom: spacing.sm }} />
                  <Text style={{ color: theme.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
                    {loadFailed ? t('assistantLoadFailed') : t('assistantEmpty')}
                  </Text>
                </View>
              ) : (
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={theme.inkSoft} />
              )
            }
          />

          {statusLabel && (
            <View style={{ flexDirection: rowDir, gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              {status !== 'slow' && <ActivityIndicator size="small" color={theme.inkSoft} />}
              <Text style={{ flex: 1, color: theme.inkSoft, fontSize: 12, textAlign }}>{statusLabel}</Text>
            </View>
          )}

          {notice && (
            <View style={{
              flexDirection: rowDir, alignItems: 'center', gap: spacing.sm,
              backgroundColor: theme.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderTopWidth: 1, borderTopColor: theme.rule,
            }}>
              <Text style={{ flex: 1, color: theme.ink, fontSize: 12.5, fontWeight: '600', textAlign }}>{t(notice)}</Text>
              <IconButton name="close" label={t('dismiss')} size={16} onPress={() => setNotice(null)} />
            </View>
          )}

          <View style={{
            paddingHorizontal: spacing.sm, paddingTop: spacing.md,
            paddingBottom: keyboardVisible ? spacing.md : TAB_BAR_CLEARANCE, borderTopWidth: 1, borderTopColor: theme.rule,
          }}>
            <View style={{ flexDirection: rowDir, gap: spacing.md, alignItems: 'center' }}>
              <TextInput
                placeholder={t('assistantPlaceholder')}
                placeholderTextColor={theme.inkSoft}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={MAX_ASSISTANT_MESSAGE}
                textAlignVertical="center"
                style={{
                  flex: 1, backgroundColor: theme.surface, borderRadius: radius.field,
                  paddingHorizontal: 10, paddingVertical: 8, color: theme.ink,
                  textAlign, maxHeight: 120,
                }}
              />
              <Pressable
                disabled={!draft.trim()}
                onPress={() => { track('assistant_send_tapped'); submit(); }}
                style={{
                  backgroundColor: draft.trim() ? theme.accent : theme.rule,
                  borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 46, alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ color: draft.trim() ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>{t('send')}</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
    </Screen>
  );
}
