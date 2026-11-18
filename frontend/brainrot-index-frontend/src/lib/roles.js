// The three family roles, as people read them.

export const ROLE_NAMES = {
  admin: 'Admin',
  adult: 'Adult',
  child: 'Child',
}

export const ROLE_DESCRIPTIONS = {
  admin: "Full control: changes everyone's settings and plugins, invites people and chooses their roles.",
  adult: 'Controls their own settings and plugins. Cannot change anyone else.',
  child: 'Settings and plugins are controlled by an admin. Posts stay blurred until checked and cannot be revealed.',
}
