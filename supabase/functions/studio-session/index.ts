import { admin, allowRate, callAgent, corsHeaders, getUser, json, withSentry } from "../_shared/mod.ts";

/**
 * Studio workout sessions — a second, independent training kind alongside
 * plan-import's gym plans (see supabase/migrations/20260809120000_studio_workouts.sql).
 * The Studio tab is the only entry point, so there's no gym/studio
 * classification here — everything through this function is studio-shaped.
 *
 *  { action: "open", source: {text|pdfBase64+filename|docxBase64+filename|imagesBase64} }
 *    -> parses via the agent's /parse-studio, then persists immediately
 *       (saved_at: null) so it's resumable server-side from the moment the
 *       board is read.
 *  { action: "open", sourceSessionId } -> "do one again": copies a saved
 *    session's structure into a new open one (lineage only, never a live
 *    reference).
 *  { action: "open", blank: true } -> "Build it myself": one empty,
 *    unlabelled block ready for the user to add exercises to.
 *  All three "open" forms 409 if the user already has an open session —
 *  the DB's partial unique index is the actual enforcement; this just
 *  surfaces it as a clean error instead of a constraint-violation 500.
 *
 *  { action: "update", sessionId, tree } -> replaces the open session's
 *    blocks/exercises wholesale. Debounced from the client on every edit.
 *  { action: "save", sessionId, tree?, score?, intensity?, note? } -> sets
 *    saved_at, closing the session. tree is optional (falls back to
 *    whatever the last "update" left in place).
 *  { action: "discard", sessionId } -> deletes the open session outright.
 *  { action: "list" } -> { open: summary|null, recent: summary[] }
 *  { action: "get", sessionId } -> the full session tree, with each
 *    exercise's "last time" value freshly resolved by name against the
 *    user's saved history (never persisted — a corrected exercise name
 *    should immediately pick up the right comparison). "open" and "get"
 *    both also return customUnits, the trainee's own persisted "+ Custom
 *    unit" entries.
 *  { action: "add-custom-unit", key, label, step, min, max } -> upserts a
 *    per-trainee custom unit (studio_custom_units), keyed by (user, key).
 *  { action: "reparse", sessionId, correctionText } -> "Did I get something
 *    wrong?" — re-sends the session's ORIGINAL source (whatever `open`
 *    parsed it from) to the agent alongside the trainee's free-text
 *    correction, and re-parses the whole workout rather than patching a
 *    field (the point of this affordance is fixing structural misreads —
 *    a ladder read as one set, a per-side value read as two tiers — which
 *    field-patching can't reach). Returns the merged tree WITHOUT writing
 *    it: exercises whose name AND shape still match the current (possibly
 *    hand-edited) tree keep the trainee's edits; exercises the new parse
 *    doesn't mention by name at all are listed in removedExerciseNames for
 *    the client to confirm before calling "update" to actually persist it.
 *    404s with no_source_to_reparse-shaped 422 if the session has no
 *    original source (a "Build it myself" or "do one again" session).
 *
 * source_payload (studio_sessions): the original source `open` parsed a
 * fresh session from, kept ONLY while the session stays open so "reparse"
 * can re-send it — `save` nulls it out, matching the original "discard the
 * photo after parsing" decision, just widened to "after parsing AND the
 * session closes" rather than immediately.
 */

type FormatType = "buyin" | "rounds" | "fortime" | "amrap" | "emom" | "intervals" | "custom";
const FORMAT_TYPES: FormatType[] = ["buyin", "rounds", "fortime", "amrap", "emom", "intervals", "custom"];
const FORMAT_PARAM_BOUNDS: Record<FormatType, Record<string, [number, number]>> = {
  buyin: {},
  fortime: {},
  rounds: { count: [1, 50] },
  amrap: { cap: [1, 120] },
  emom: { every: [1, 30], total: [1, 180] },
  intervals: { on: [5, 600], off: [5, 600] },
  custom: {},
};

interface TreeMetric {
  unit: string;
  value: number;
  tiers: number[] | null;
  tierIndex: number | null;
  // "6/6 pistol" — one value, done each side. Mutually exclusive with
  // tiers (two IDENTICAL board numbers, not two different ones) and with
  // ladder.
  perSide: boolean;
  // "10-8-6-3-3 Deadlift" — one value per round. Mutually exclusive with
  // tiers/perSide. `value` is only a fallback (the first round) when this
  // is set.
  ladder: number[] | null;
}
interface TreeExercise {
  name: string;
  parseConfidence: "low" | null;
  metrics: TreeMetric[]; // [primary] or [primary, extra] — never more
}
interface TreeBlock {
  name: string | null;
  formatType: FormatType | null;
  formatParams: Record<string, number>;
  formatCustom: string | null;
  exercises: TreeExercise[];
}
interface Tree {
  name: string;
  scoreType: "fortime" | "amrap" | "emom" | "strength" | null;
  blocks: TreeBlock[];
}

function validMetric(m: unknown): m is TreeMetric {
  if (typeof m !== "object" || m === null) return false;
  const r = m as Record<string, unknown>;
  if (typeof r.unit !== "string" || r.unit.length < 1 || r.unit.length > 20) return false;
  if (typeof r.value !== "number" || !Number.isFinite(r.value) || r.value < 0 || r.value > 5000) return false;
  if (typeof r.perSide !== "boolean") return false;
  if (r.ladder !== null) {
    if (!Array.isArray(r.ladder) || r.ladder.length < 3 || r.ladder.length > 20) return false;
    if (r.ladder.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2000)) return false;
  }
  if (r.tiers !== null) {
    if (!Array.isArray(r.tiers) || r.tiers.length < 2 || r.tiers.length > 5) return false;
    if (r.tiers.some((t) => typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 5000)) return false;
  }
  if (r.tierIndex !== null) {
    if (!Number.isInteger(r.tierIndex) || r.tierIndex < 0) return false;
    if (!Array.isArray(r.tiers) || (r.tierIndex as number) >= r.tiers.length) return false;
  }
  // Mutually exclusive: a ladder or a per-side value never also carries
  // scaling tiers — three completely different board notations.
  const shapes = [r.ladder !== null, r.perSide === true, r.tiers !== null].filter(Boolean).length;
  if (shapes > 1) return false;
  return true;
}

function validExercise(e: unknown): e is TreeExercise {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length < 1 || r.name.length > 200) return false;
  if (r.parseConfidence !== null && r.parseConfidence !== "low") return false;
  if (!Array.isArray(r.metrics) || r.metrics.length < 1 || r.metrics.length > 2) return false;
  return r.metrics.every(validMetric);
}

function validBlock(b: unknown): b is TreeBlock {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  if (r.name !== null && (typeof r.name !== "string" || r.name.length > 120)) return false;
  // null = no format was ever chosen for this block — most blocks on a
  // real board don't have one; not the same as 'buyin' (a real, distinct
  // bookending-pair format).
  if (r.formatType !== null && (typeof r.formatType !== "string" || !FORMAT_TYPES.includes(r.formatType as FormatType))) {
    return false;
  }
  const bounds = r.formatType === null ? {} : FORMAT_PARAM_BOUNDS[r.formatType as FormatType];
  const params = r.formatParams;
  if (typeof params !== "object" || params === null) return false;
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const v = (params as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return false;
  }
  if (r.formatType === "custom") {
    if (typeof r.formatCustom !== "string" || r.formatCustom.length < 1 || r.formatCustom.length > 60) return false;
  } else if (r.formatCustom !== null) return false;
  if (!Array.isArray(r.exercises) || r.exercises.length < 0 || r.exercises.length > 30) return false;
  return r.exercises.every(validExercise);
}

function validTree(t: unknown): t is Tree {
  if (typeof t !== "object" || t === null) return false;
  const r = t as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length < 1 || r.name.length > 120) return false;
  if (r.scoreType !== null && !["fortime", "amrap", "emom", "strength"].includes(r.scoreType as string)) {
    return false;
  }
  if (!Array.isArray(r.blocks) || r.blocks.length < 1 || r.blocks.length > 20) return false;
  return r.blocks.every(validBlock);
}

/** Case-insensitive "last time" lookup, scoped to the caller's own saved
 * sessions. One bounded query, reduced in JS — simpler and more robust than
 * relying on PostgREST to order/distinct across a two-level embed, and
 * cheap at the personal-history scale this ever runs at. */
async function lastValuesByName(
  db: ReturnType<typeof admin>,
  userId: string,
  names: string[],
): Promise<Map<string, TreeExercise>> {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const result = new Map<string, TreeExercise>();
  if (wanted.size === 0) return result;

  const { data: rows } = await db
    .from("studio_exercises")
    .select(
      "name, unit, value, tiers, tier_index, per_side, ladder, extra_unit, extra_value, extra_tiers, extra_tier_index, extra_per_side, " +
        "studio_blocks!inner(studio_sessions!inner(user_id, saved_at))",
    )
    .eq("studio_blocks.studio_sessions.user_id", userId)
    .not("studio_blocks.studio_sessions.saved_at", "is", null)
    .limit(500);

  const bestSavedAt = new Map<string, string>();
  for (const row of rows ?? []) {
    const key = String(row.name).trim().toLowerCase();
    if (!wanted.has(key)) continue;
    // deno-lint-ignore no-explicit-any
    const savedAt = (row as any).studio_blocks?.studio_sessions?.saved_at as string;
    if (bestSavedAt.has(key) && bestSavedAt.get(key)! >= savedAt) continue;
    bestSavedAt.set(key, savedAt);
    const metrics: TreeMetric[] = [
      { unit: row.unit, value: row.value, tiers: row.tiers, tierIndex: row.tier_index, perSide: row.per_side, ladder: row.ladder },
    ];
    if (row.extra_unit) {
      metrics.push({
        unit: row.extra_unit,
        value: row.extra_value,
        tiers: row.extra_tiers,
        tierIndex: row.extra_tier_index,
        perSide: row.extra_per_side,
        ladder: null,
      });
    }
    result.set(key, { name: row.name, parseConfidence: null, metrics });
  }
  return result;
}

/** Applies each exercise's last-taken tier as its default tierIndex/value,
 * preferring the trainee's own history over the parser's middle-tier guess. */
function applyLastTiers(tree: Tree, history: Map<string, TreeExercise>): void {
  for (const block of tree.blocks) {
    for (const exercise of block.exercises) {
      const last = history.get(exercise.name.trim().toLowerCase());
      if (!last) continue;
      exercise.metrics.forEach((m, i) => {
        const lastMetric = last.metrics[i];
        if (lastMetric && m.tiers && lastMetric.tiers) {
          const idx = m.tiers.indexOf(lastMetric.value);
          if (idx >= 0) {
            m.tierIndex = idx;
            m.value = m.tiers[idx];
          }
        }
      });
    }
  }
}

/** Defense in depth alongside parseStudio.ts's own normalizeTiers: `open`
 * writes the agent's response straight to the DB without running it through
 * validTree (that validator is only invoked for a client-submitted `update`/
 * `save`), so a self-inconsistent metric here would otherwise sit in the DB
 * until the first autosave round-trips it back through validTree and gets
 * silently rejected. */
function normalizeTierConsistency(blocks: TreeBlock[]): void {
  for (const block of blocks) {
    let maxLadderLen = 0;
    for (const exercise of block.exercises) {
      for (const metric of exercise.metrics) {
        if (metric.ladder && metric.ladder.length >= 3) {
          metric.tiers = null;
          metric.tierIndex = null;
          metric.perSide = false;
          maxLadderLen = Math.max(maxLadderLen, metric.ladder.length);
          continue;
        }
        metric.ladder = null;
        if (metric.perSide) {
          metric.tiers = null;
          metric.tierIndex = null;
          continue;
        }
        if (!metric.tiers || metric.tiers.length < 2) {
          metric.tiers = null;
          metric.tierIndex = null;
        } else if (metric.tierIndex == null || metric.tierIndex >= metric.tiers.length) {
          metric.tierIndex = Math.floor((metric.tiers.length - 1) / 2);
        }
      }
    }
    if (maxLadderLen > 0 && (block.formatType == null || block.formatType === "rounds")) {
      block.formatType = "rounds";
      block.formatParams = { ...block.formatParams, count: maxLadderLen };
    }
  }
}

/** Writes every block, then every exercise across all of them, as two
 * batched inserts total rather than one round trip per block plus one per
 * block's exercises — the previous per-block loop meant a 7-block workout
 * (a completely ordinary size) cost ~14 sequential awaited round trips, on
 * both the "do one again" copy path and every single debounced autosave
 * while editing. Block IDs are recovered by re-sorting the batch insert's
 * returned rows by order_index, since a multi-row insert's result order
 * isn't guaranteed to match input order. */
async function insertBlocksAndExercises(
  db: ReturnType<typeof admin>,
  sessionId: string,
  blocks: TreeBlock[],
): Promise<{ error: string; status: number } | null> {
  if (blocks.length === 0) return null;
  const { data: insertedBlocks, error: blockError } = await db
    .from("studio_blocks")
    .insert(blocks.map((b, bi) => ({
      session_id: sessionId,
      order_index: bi,
      name: b.name,
      format_type: b.formatType,
      format_params: b.formatParams,
      format_custom: b.formatCustom,
    })))
    .select("id, order_index")
    .order("order_index");
  if (blockError || !insertedBlocks || insertedBlocks.length !== blocks.length) {
    return { error: "write_failed", status: 500 };
  }

  const exerciseRows = blocks.flatMap((b, bi) => b.exercises.map((e, ei) => ({
    block_id: insertedBlocks[bi].id,
    order_index: ei,
    name: e.name,
    parse_confidence: e.parseConfidence,
    unit: e.metrics[0].unit,
    value: e.metrics[0].value,
    tiers: e.metrics[0].tiers,
    tier_index: e.metrics[0].tierIndex,
    per_side: e.metrics[0].perSide,
    ladder: e.metrics[0].ladder,
    extra_unit: e.metrics[1]?.unit ?? null,
    extra_value: e.metrics[1]?.value ?? null,
    extra_tiers: e.metrics[1]?.tiers ?? null,
    extra_tier_index: e.metrics[1]?.tierIndex ?? null,
    extra_per_side: e.metrics[1]?.perSide ?? false,
  })));
  if (exerciseRows.length > 0) {
    const { error: exError } = await db.from("studio_exercises").insert(exerciseRows);
    if (exError) return { error: "write_failed", status: 500 };
  }
  return null;
}

function metricShape(m: TreeMetric): string {
  return `${m.unit}|${m.perSide}|${m.ladder ? `ladder${m.ladder.length}` : m.tiers ? `tiers${m.tiers.length}` : "plain"}`;
}
function exerciseShape(e: TreeExercise): string {
  return e.metrics.map(metricShape).join(",");
}

/** "Did I get something wrong?" re-parse: matches exercises across the
 * current (possibly hand-edited) tree and a fresh re-parse by name. Where
 * an old exercise's shape (unit/perSide/ladder-or-tiers) still matches the
 * new parse's, the OLD one wins — preserving any value the trainee already
 * typed. Where the shape changed, the NEW one wins — that's the correction
 * actually doing its job (a ladder that was mis-read as one set, say).
 * Old exercises with no name match anywhere in the new tree are reported
 * as removed rather than silently dropped, so the client can warn before
 * this gets persisted via the normal "update" action. */
function mergePreservingEdits(oldTree: Tree, newTree: Tree): { merged: Tree; removed: string[] } {
  const oldByName = new Map<string, TreeExercise>();
  for (const block of oldTree.blocks) {
    for (const exercise of block.exercises) {
      oldByName.set(exercise.name.trim().toLowerCase(), exercise);
    }
  }
  const matched = new Set<string>();

  const merged: Tree = {
    name: newTree.name,
    scoreType: newTree.scoreType,
    blocks: newTree.blocks.map((block) => ({
      ...block,
      exercises: block.exercises.map((exercise) => {
        const key = exercise.name.trim().toLowerCase();
        const old = oldByName.get(key);
        if (!old) return exercise;
        matched.add(key);
        return exerciseShape(old) === exerciseShape(exercise) ? old : exercise;
      }),
    })),
  };

  const removed: string[] = [];
  for (const [key, exercise] of oldByName) {
    if (!matched.has(key)) removed.push(exercise.name);
  }
  return { merged, removed };
}

async function insertTree(
  db: ReturnType<typeof admin>,
  userId: string,
  name: string,
  scoreType: Tree["scoreType"],
  blocks: TreeBlock[],
  sourceSessionId: string | null,
  sourcePayload: unknown = null,
): Promise<{ id: string } | { error: string; status: number }> {
  const { data: session, error: sessionError } = await db
    .from("studio_sessions")
    .insert({
      user_id: userId, name, score_type: scoreType, source_session_id: sourceSessionId,
      source_payload: sourcePayload,
    })
    .select("id")
    .single();
  if (sessionError) {
    if (sessionError.code === "23505") return { error: "session_already_open", status: 409 };
    return { error: "write_failed", status: 500 };
  }

  const writeError = await insertBlocksAndExercises(db, session.id, blocks);
  if (writeError) {
    await db.from("studio_sessions").delete().eq("id", session.id);
    return writeError;
  }
  return { id: session.id };
}

async function fetchCustomUnits(db: ReturnType<typeof admin>, userId: string) {
  const { data } = await db
    .from("studio_custom_units")
    .select("id, key, label, step, min, max")
    .eq("user_id", userId)
    .order("created_at");
  return data ?? [];
}

/** Reassembles a session's rows (blocks + inline metrics) into the wire Tree shape. */
async function readTree(db: ReturnType<typeof admin>, sessionId: string): Promise<Tree | null> {
  const { data: session } = await db
    .from("studio_sessions")
    .select("name, score_type")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;
  const { data: blocks } = await db
    .from("studio_blocks")
    .select("id, order_index, name, format_type, format_params, format_custom")
    .eq("session_id", sessionId)
    .order("order_index");
  const { data: exercises } = await db
    .from("studio_exercises")
    .select(
      "block_id, order_index, name, parse_confidence, unit, value, tiers, tier_index, per_side, ladder, " +
        "extra_unit, extra_value, extra_tiers, extra_tier_index, extra_per_side",
    )
    .in("block_id", (blocks ?? []).map((b) => b.id))
    .order("order_index");

  return {
    name: session.name,
    scoreType: session.score_type,
    blocks: (blocks ?? []).map((b) => ({
      name: b.name,
      formatType: b.format_type,
      formatParams: b.format_params,
      formatCustom: b.format_custom,
      exercises: (exercises ?? [])
        .filter((e) => e.block_id === b.id)
        .map((e) => ({
          name: e.name,
          parseConfidence: e.parse_confidence,
          metrics: [
            { unit: e.unit, value: e.value, tiers: e.tiers, tierIndex: e.tier_index, perSide: e.per_side, ladder: e.ladder },
            ...(e.extra_unit
              ? [{
                unit: e.extra_unit, value: e.extra_value, tiers: e.extra_tiers, tierIndex: e.extra_tier_index,
                perSide: e.extra_per_side, ladder: null,
              }]
              : []),
          ],
        })),
    })),
  };
}

Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  // Higher than plan-import's 10/60s: "update" is a debounced autosave that
  // can legitimately fire roughly once per second during active editing,
  // not a one-shot parse call.
  if (!(await allowRate(db, user.id, "studio-session", 60, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "open") {
    let tree: Tree;
    let sourceSessionId: string | null = null;
    // The original source, kept only for the "reparse" action — null for
    // blank/copied sessions, which have no board to re-send.
    let sourcePayload: unknown = null;

    if (body.blank === true) {
      tree = {
        name: "New workout",
        scoreType: null,
        blocks: [{ name: null, formatType: null, formatParams: {}, formatCustom: null, exercises: [] }],
      };
    } else if (typeof body.sourceSessionId === "string") {
      const { data: owned } = await db
        .from("studio_sessions")
        .select("id, name")
        .eq("id", body.sourceSessionId)
        .eq("user_id", user.id)
        .not("saved_at", "is", null)
        .maybeSingle();
      if (!owned) return json(404, { error: "session_not_found" });
      const copied = await readTree(db, owned.id);
      if (!copied) return json(404, { error: "session_not_found" });
      tree = copied;
      sourceSessionId = owned.id;
    } else {
      const source = body.source as Record<string, unknown> | undefined;
      let agentPayload:
        | { text: string }
        | { pdfBase64: string; filename: string }
        | { docxBase64: string; filename: string }
        | { imagesBase64: string[] };
      if (!source || typeof source !== "object") return json(400, { error: "invalid_input" });
      if (Array.isArray(source.imagesBase64)) {
        const images = source.imagesBase64;
        if (
          images.length < 1 || images.length > 3 ||
          images.some((img) => typeof img !== "string" || img.length < 100 || img.length > 2 * 1024 * 1024)
        ) {
          return json(400, { error: "invalid_input" });
        }
        agentPayload = { imagesBase64: images };
      } else if (typeof source.pdfBase64 === "string" || typeof source.docxBase64 === "string") {
        const fileBase64 = (source.pdfBase64 ?? source.docxBase64) as string;
        if (
          fileBase64.length < 100 || fileBase64.length > 16 * 1024 * 1024 ||
          typeof source.filename !== "string" || source.filename.length < 1 || source.filename.length > 200
        ) {
          return json(400, { error: "invalid_input" });
        }
        agentPayload = typeof source.pdfBase64 === "string"
          ? { pdfBase64: source.pdfBase64, filename: source.filename }
          : { docxBase64: source.docxBase64 as string, filename: source.filename };
      } else {
        if (typeof source.text !== "string" || source.text.length < 10 || source.text.length > 20000) {
          return json(400, { error: "invalid_input" });
        }
        agentPayload = { text: source.text };
      }
      const res = await callAgent(agentPayload, "/parse-studio");
      if (!res.ok) {
        return json(res.status === 422 ? 422 : 503, {
          error: res.status === 422 ? "unparseable" : "parser_unavailable",
        });
      }
      tree = (await res.json()) as Tree;
      sourcePayload = agentPayload;
    }

    const names = tree.blocks.flatMap((b) => b.exercises.map((e) => e.name));
    const history = await lastValuesByName(db, user.id, names);
    applyLastTiers(tree, history);
    normalizeTierConsistency(tree.blocks);

    const inserted = await insertTree(db, user.id, tree.name, tree.scoreType, tree.blocks, sourceSessionId, sourcePayload);
    if ("error" in inserted) return json(inserted.status, { error: inserted.error });

    return json(200, {
      sessionId: inserted.id,
      tree,
      last: Object.fromEntries(
        names.map((n) => [n, history.get(n.trim().toLowerCase())?.metrics ?? null]),
      ),
      customUnits: await fetchCustomUnits(db, user.id),
    });
  }

  if (body.action === "update" || body.action === "save") {
    if (typeof body.sessionId !== "string") return json(400, { error: "invalid_input" });
    const { data: owned } = await db
      .from("studio_sessions")
      .select("id")
      .eq("id", body.sessionId)
      .eq("user_id", user.id)
      .is("saved_at", null)
      .maybeSingle();
    if (!owned) return json(404, { error: "session_not_found" });

    if (body.tree !== undefined) {
      if (!validTree(body.tree)) return json(400, { error: "invalid_input" });
      const tree = body.tree as Tree;
      await db.from("studio_blocks").delete().eq("session_id", owned.id); // cascades to studio_exercises
      const writeError = await insertBlocksAndExercises(db, owned.id, tree.blocks);
      if (writeError) return json(writeError.status, { error: writeError.error });
      await db.from("studio_sessions").update({ name: tree.name, score_type: tree.scoreType }).eq("id", owned.id);
    }

    if (body.action === "update") return json(200, { ok: true });

    // save
    const score = body.score;
    if (score !== undefined && score !== null && typeof score !== "object") {
      return json(400, { error: "invalid_input" });
    }
    const intensity = body.intensity;
    if (intensity !== undefined && intensity !== null && (!Number.isInteger(intensity) || (intensity as number) < 1 || (intensity as number) > 5)) {
      return json(400, { error: "invalid_input" });
    }
    const note = body.note;
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 1000)) {
      return json(400, { error: "invalid_input" });
    }
    const { error: saveError } = await db
      .from("studio_sessions")
      .update({
        saved_at: new Date().toISOString(),
        score: score ?? null,
        intensity: intensity ?? null,
        note: note ?? null,
        // A saved session's row never carries the original board — matches
        // the "discard the photo" decision, just widened to "once the
        // session closes" rather than immediately after parsing.
        source_payload: null,
      })
      .eq("id", owned.id);
    if (saveError) return json(500, { error: "write_failed" });
    return json(200, { ok: true });
  }

  if (body.action === "discard") {
    if (typeof body.sessionId !== "string") return json(400, { error: "invalid_input" });
    const { data, error } = await db
      .from("studio_sessions")
      .delete()
      .eq("id", body.sessionId)
      .eq("user_id", user.id)
      .is("saved_at", null)
      .select("id")
      .maybeSingle();
    if (error) return json(500, { error: "write_failed" });
    if (!data) return json(404, { error: "session_not_found" });
    return json(200, { discarded: true });
  }

  if (body.action === "reparse") {
    if (typeof body.sessionId !== "string") return json(400, { error: "invalid_input" });
    const correctionText = body.correctionText;
    if (typeof correctionText !== "string" || correctionText.trim().length < 3 || correctionText.length > 500) {
      return json(400, { error: "invalid_input" });
    }
    const { data: owned } = await db
      .from("studio_sessions")
      .select("id, source_payload")
      .eq("id", body.sessionId)
      .eq("user_id", user.id)
      .is("saved_at", null)
      .maybeSingle();
    if (!owned) return json(404, { error: "session_not_found" });
    if (!owned.source_payload) return json(422, { error: "no_source_to_reparse" });

    const oldTree = await readTree(db, owned.id);
    if (!oldTree) return json(404, { error: "session_not_found" });

    const res = await callAgent(
      { ...(owned.source_payload as Record<string, unknown>), correctionNote: correctionText },
      "/parse-studio",
    );
    if (!res.ok) {
      return json(res.status === 422 ? 422 : 503, {
        error: res.status === 422 ? "unparseable" : "parser_unavailable",
      });
    }
    const newTree = (await res.json()) as Tree;

    const names = newTree.blocks.flatMap((b) => b.exercises.map((e) => e.name));
    const history = await lastValuesByName(db, user.id, names);
    applyLastTiers(newTree, history);
    normalizeTierConsistency(newTree.blocks);

    const { merged, removed } = mergePreservingEdits(oldTree, newTree);

    return json(200, {
      tree: merged,
      removedExerciseNames: removed,
      last: Object.fromEntries(
        names.map((n) => [n, history.get(n.trim().toLowerCase())?.metrics ?? null]),
      ),
    });
  }

  if (body.action === "get") {
    if (typeof body.sessionId !== "string") return json(400, { error: "invalid_input" });
    const { data: owned } = await db
      .from("studio_sessions")
      .select("id, saved_at, score, intensity, note")
      .eq("id", body.sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) return json(404, { error: "session_not_found" });
    const tree = await readTree(db, owned.id);
    if (!tree) return json(404, { error: "session_not_found" });
    const names = tree.blocks.flatMap((b) => b.exercises.map((e) => e.name));
    const history = await lastValuesByName(db, user.id, names);
    return json(200, {
      sessionId: owned.id,
      savedAt: owned.saved_at,
      score: owned.score,
      intensity: owned.intensity,
      note: owned.note,
      tree,
      last: Object.fromEntries(
        names.map((n) => [n, history.get(n.trim().toLowerCase())?.metrics ?? null]),
      ),
      customUnits: await fetchCustomUnits(db, user.id),
    });
  }

  if (body.action === "add-custom-unit") {
    const key = body.key;
    const label = body.label;
    const step = body.step;
    const min = body.min;
    const max = body.max;
    if (typeof key !== "string" || !/^[a-z0-9_]{1,20}$/.test(key)) return json(400, { error: "invalid_input" });
    if (typeof label !== "string" || label.length < 1 || label.length > 30) return json(400, { error: "invalid_input" });
    if (typeof step !== "number" || !Number.isFinite(step) || step <= 0 || step > 1000) {
      return json(400, { error: "invalid_input" });
    }
    if (typeof min !== "number" || !Number.isFinite(min) || min < 0 || min > 5000) {
      return json(400, { error: "invalid_input" });
    }
    if (typeof max !== "number" || !Number.isFinite(max) || max <= min || max > 10000) {
      return json(400, { error: "invalid_input" });
    }
    const { data, error } = await db
      .from("studio_custom_units")
      .upsert({ user_id: user.id, key, label, step, min, max }, { onConflict: "user_id,key" })
      .select("id, key, label, step, min, max")
      .single();
    if (error || !data) return json(500, { error: "write_failed" });
    return json(200, { customUnit: data });
  }

  if (body.action === "list") {
    const { data: open } = await db
      .from("studio_sessions")
      .select("id, name, started_at")
      .eq("user_id", user.id)
      .is("saved_at", null)
      .maybeSingle();

    const { data: recent } = await db
      .from("studio_sessions")
      .select("id, name, saved_at, intensity")
      .eq("user_id", user.id)
      .not("saved_at", "is", null)
      .order("saved_at", { ascending: false })
      .limit(30);

    const sessionIds = (recent ?? []).map((s) => s.id);
    const { data: blocks } = sessionIds.length
      ? await db.from("studio_blocks").select("id, session_id, name").in("session_id", sessionIds)
      : { data: [] as { id: string; session_id: string; name: string | null }[] };
    const blockIds = (blocks ?? []).map((b) => b.id);
    const { data: exercises } = blockIds.length
      ? await db.from("studio_exercises").select("block_id, name").in("block_id", blockIds)
      : { data: [] as { block_id: string; name: string }[] };

    const blocksBySession = new Map<string, typeof blocks>();
    for (const b of blocks ?? []) {
      blocksBySession.set(b.session_id, [...(blocksBySession.get(b.session_id) ?? []), b]);
    }
    const exercisesByBlock = new Map<string, string[]>();
    for (const e of exercises ?? []) {
      exercisesByBlock.set(e.block_id, [...(exercisesByBlock.get(e.block_id) ?? []), e.name]);
    }

    const summaries = (recent ?? []).map((s) => {
      const sessionBlocks = blocksBySession.get(s.id) ?? [];
      const hasNamedBlocks = sessionBlocks.some((b) => b!.name !== null);
      const movementNames = sessionBlocks.flatMap((b) => exercisesByBlock.get(b!.id) ?? []);
      return {
        id: s.id,
        name: s.name,
        blockCount: hasNamedBlocks ? sessionBlocks.length : 0,
        exerciseCount: movementNames.length,
        movements: movementNames.slice(0, 4),
        movementsMore: Math.max(0, movementNames.length - 4),
        savedAt: s.saved_at,
        intensity: s.intensity,
      };
    });

    return json(200, {
      open: open ? { id: open.id, name: open.name, startedAt: open.started_at } : null,
      recent: summaries,
    });
  }

  return json(400, { error: "unknown_action" });
}));
