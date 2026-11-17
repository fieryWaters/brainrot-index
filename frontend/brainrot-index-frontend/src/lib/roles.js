// The three family roles, as people read them.

export const ROLE_NAMES = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  child: 'Child',
}

export const ROLE_DESCRIPTIONS = {
  superadmin: "Can change everyone's settings, plugins and roles.",
  admin: 'Can change only their own settings and plugins.',
  child: 'Cannot change settings or plugins. Posts stay blurred until checked and cannot be revealed.',
}
