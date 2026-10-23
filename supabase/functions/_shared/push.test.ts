import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { pushAnswerForLog } from "./push.ts";

Deno.test("push log: a ticket per token, its status, error and id", () => {
  const log = pushAnswerForLog(200, {
    data: [
      { status: "ok", id: "ticket-1" },
      {
        status: "error",
        message: '"ExponentPushToken[abc123]" is not a registered push notification recipient',
        details: { error: "DeviceNotRegistered", expoPushToken: "ExponentPushToken[abc123]" },
      },
    ],
  });
  assertEquals(log, {
    http: 200,
    tickets: [
      { status: "ok", id: "ticket-1" },
      { status: "error", error: "DeviceNotRegistered", message: '"<token>" is not a registered push notification recipient' },
    ],
  });
});

Deno.test("push log: never a push token, from a message, an error or a request error", () => {
  const log = pushAnswerForLog(400, {
    errors: [{ code: "VALIDATION_ERROR", message: "bad recipient ExpoPushToken[zzz]" }],
    data: [{ status: "error", details: { error: "ExponentPushToken[abc]" } }],
  });
  assertFalse(JSON.stringify(log).includes("PushToken["));
  assertEquals(log.errors, [{ code: "VALIDATION_ERROR", message: "bad recipient <token>" }]);
});

Deno.test("push log: an answer that isn't JSON keeps the HTTP status", () => {
  assertEquals(pushAnswerForLog(502, null), { http: 502 });
});
