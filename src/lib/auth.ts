const AUTH_KEY = 'plcp-admin-auth'

export function getAdminPassword() {
  return import.meta.env.VITE_ADMIN_PASSWORD?.trim() || 'change-me'
}

export function isAdminAuthenticated() {
  return sessionStorage.getItem(AUTH_KEY) === 'true'
}

export function setAdminAuthenticated(value: boolean) {
  if (value) {
    sessionStorage.setItem(AUTH_KEY, 'true')
    return
  }

  sessionStorage.removeItem(AUTH_KEY)
}
