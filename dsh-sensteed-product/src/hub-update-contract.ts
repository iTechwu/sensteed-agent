export const HUB_UPDATES_PATH = '/api/desktop/hub/updates'
export const HUB_API_ORIGIN = 'https://ai.hozonauto.com/plugins/api'

export interface HubPublishedUpdate {
  kind: 'plugin' | 'skill'
  itemId: string
  displayName: string
  version: string
}
