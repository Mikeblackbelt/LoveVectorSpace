// Which apps each reader covers. Package names must match the Android side
// (android/app/src/sideload/.../CaptureApps.java and res/xml/lvs_accessibility_config.xml).
import type { AppSlug, ReaderMethod } from './types';

export const APP_LABELS: Record<AppSlug, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  tinder: 'Tinder',
  hinge: 'Hinge',
  grindr: 'Grindr',
  bumble: 'Bumble',
  discord: 'Discord',
  google_messages: 'Google Messages',
};

export const APP_PACKAGES: Record<AppSlug, string[]> = {
  whatsapp: ['com.whatsapp', 'com.whatsapp.w4b'],
  instagram: ['com.instagram.android'],
  tinder: ['com.tinder'],
  hinge: ['co.hinge.app'],
  grindr: ['com.grindrapp.android'],
  bumble: ['com.bumble.app'],
  discord: ['com.discord'],
  google_messages: ['com.google.android.apps.messaging'],
};

/** Apps each reader accepts (spec §11). */
export const METHOD_APPS: Record<Exclude<ReaderMethod, 'sms'>, AppSlug[]> = {
  notify: ['whatsapp', 'instagram', 'tinder', 'grindr', 'bumble', 'discord'],
  a11y: ['whatsapp', 'instagram', 'tinder', 'hinge', 'grindr', 'bumble', 'discord', 'google_messages'],
};
