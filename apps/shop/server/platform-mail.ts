import { tr } from "../shared/i18n.ts";
import { sendMail, encrypt, type MailAttachment } from "./google.ts";

export type PlatformMailer = (to: string, subject: string, text: string, cc?: string[], attachments?: MailAttachment[], senderEmail?: string) => Promise<void>;
/** A service-level Gmail sender; shop owners do not need a Google account to receive login links. */
export function platformMailer(): PlatformMailer {
  return async (to, subject, text, cc = [], attachments = [], senderEmail) => {
    if (process.env.PARENT_MAIL_URL) {
      const url = new URL(process.env.PARENT_MAIL_URL);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("PARENT_MAIL_URL must use HTTPS or loopback HTTP");
      const secret = process.env.PARENT_INTEGRATION_SECRET || "";
      if (secret.length < 32) throw new Error("PARENT_INTEGRATION_SECRET must contain at least 32 characters");
      const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ to, subject, text, cc, senderEmail, attachments: attachments.map(file => ({ ...file, data: file.data.toString("base64") })) }) });
      if (!response.ok) throw Object.assign(new Error(tr("運営側のGmailからメールを送信できませんでした。")), { status: 503 });
      await response.body?.cancel();
      return;
    }
    const refresh = process.env.PLATFORM_GMAIL_REFRESH_TOKEN;
    if (!refresh) throw Object.assign(new Error(tr("運営側のGmail送信設定が必要です。")), { status: 503 });
    await sendMail(encrypt(refresh), to, subject, text, cc, attachments);
  };
}
