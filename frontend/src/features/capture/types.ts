// Shared types for phone capture (screenshot OCR + Android readers).
// Nothing here ever holds an image: OCR runs on the device and only text + boxes reach JS.

export type Role = 'me' | 'them';
export type TsPrecision = 'second' | 'minute' | 'approx';

/** One recognised text line, in image pixels (origin top-left). */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** OCR result for one screenshot. */
export interface OcrImage {
  width: number;
  height: number;
  lines: OcrLine[];
}

export interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export interface Hm {
  h: number; // 0-23
  m: number;
}

/** A centred date/time separator ("Today", "Mon 10:42 PM", "12 March 2026"). */
export interface SeparatorItem {
  kind: 'separator';
  raw: string;
  date?: Ymd;
  time?: Hm;
}

/** A chat bubble after segmentation. `time` is a time printed inside/under the bubble. */
export interface BubbleItem {
  kind: 'bubble';
  role: Role;
  text: string;
  time?: Hm;
}

export type ChatItem = SeparatorItem | BubbleItem;

/** Wire format for POST /api/people/{pid}/imports/messages. */
export interface WireMessage {
  ts_local?: string;
  ts_utc?: string;
  ts_precision: TsPrecision;
  role: Role;
  text: string;
}

export interface ImportMessagesBody {
  source: string;
  tz: string;
  messages: WireMessage[];
}

/** Capture methods on the phone. */
export type CaptureMethod = 'screenshot' | 'notify' | 'sms' | 'a11y';
export type ReaderMethod = Exclude<CaptureMethod, 'screenshot'>;

/** App slugs used in `android_notify_<app>` / `android_a11y_<app>` sources. */
export type AppSlug =
  | 'whatsapp'
  | 'instagram'
  | 'tinder'
  | 'hinge'
  | 'grindr'
  | 'bumble'
  | 'discord'
  | 'google_messages';

/** A contact the user linked to a person for one reader. `contact` is a chat title or phone number. */
export interface CaptureLink {
  method: ReaderMethod;
  app: AppSlug | 'sms';
  contact: string;
  pid: number;
}
