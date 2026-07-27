import { Text, type TextStyle } from 'react-native';

/**
 * Minimal inline formatting for coach messages: **bold** only — matches
 * FORMATTING_GUIDE in the agent's prompt, which tells the model this is
 * the only markdown the client renders. Everything else (headers, lists,
 * links, code blocks) is never requested, so there's nothing else to parse.
 */
export function MarkdownText({ children, style }: { children: string; style?: TextStyle }) {
  const parts = children.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        return bold ? <Text key={i} style={{ fontWeight: '800' }}>{bold[1]}</Text> : part;
      })}
    </Text>
  );
}
