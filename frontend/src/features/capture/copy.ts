// User-facing explanations for each capture method (consent screens and settings).
import type { ReaderMethod } from './types';

export const PRIVACY_NOTE =
  'Phone capture only ever reads chats you linked to a person. Screenshots are read on this phone and never uploaded; ' +
  'only the extracted messages are sent, after you review them. Captured messages wait encrypted on this phone until ' +
  'they upload, and message text is never written to any log. You can pause capture or delete what was captured for a contact at any time.';

export interface MethodCopy {
  title: string;
  tech: string;
  short: string;
  reads: string[];
  never: string[];
  access: string;
}

export const METHOD_COPY: Record<ReaderMethod, MethodCopy> = {
  notify: {
    title: 'Notification reader',
    tech: 'NOTIFY READER',
    short: 'Saves incoming message notifications from linked contacts (WhatsApp, Instagram, Tinder, Grindr, Bumble, Discord).',
    reads: [
      'The sender and text of new message notifications from those apps.',
      'Only when the sender matches a contact you linked to a person. Everything else is ignored immediately and never stored.',
    ],
    never: [
      'Messages you send (notifications only show the other side), so this counts as one-sided unless you add another source.',
      'Notifications from any other app.',
    ],
    access: 'Android asks you to allow "Notification access" for LoveVectorSpace in system settings.',
  },
  sms: {
    title: 'SMS reader',
    tech: 'SMS READER',
    short: 'Reads both sides of text-message threads with linked phone numbers.',
    reads: [
      'SMS and MMS text sent to and received from the phone numbers you link.',
      'Only new messages since the last sync, when the app is open.',
    ],
    never: ['Texts with any number you did not link.', 'Photos or other MMS attachments.'],
    access: 'Android asks you to allow "SMS" permission.',
  },
  a11y: {
    title: 'Accessibility chat reader',
    tech: 'A11Y READER',
    short: 'Reads both sides of a linked chat from the screen while you have it open (WhatsApp, Instagram, Tinder, Hinge, Grindr, Bumble, Discord, Google Messages).',
    reads: [
      'The message bubbles and date separators visible on screen, only in those eight apps.',
      'Only while a chat whose title matches a linked contact is open. Other chats and screens are skipped.',
      'Bubble sides (left = them, right = you) are worked out on this phone.',
    ],
    never: [
      'Password fields or anything you are typing.',
      'Any other app: Android only sends this service events from the listed apps.',
    ],
    access:
      'Android asks you to switch on the "LoveVectorSpace chat reader" accessibility service. It pauses itself after 30 minutes without a linked chat, ' +
      'and a notification shows while it is capturing, with a one-tap pause.',
  },
};

export const RESTRICTED_SETTINGS_HINT =
  'On Android 13 and later, apps installed from an APK cannot get notification or accessibility access until you open ' +
  'App info → ⋮ → "Allow restricted settings".';
