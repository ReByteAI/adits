import 'i18next'

import common from './locales/en/common.json'
import auth from './locales/en/auth.json'
import projects from './locales/en/projects.json'
import workspace from './locales/en/workspace.json'
import chat from './locales/en/chat.json'
import files from './locales/en/files.json'
import errors from './locales/en/errors.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      auth: typeof auth
      projects: typeof projects
      workspace: typeof workspace
      chat: typeof chat
      files: typeof files
      errors: typeof errors
    }
  }
}
