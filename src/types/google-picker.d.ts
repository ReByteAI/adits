/**
 * Type declarations for Google Picker API and Google Identity Services
 *
 * @see https://developers.google.com/picker/docs/reference
 * @see https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

/** Minimal gapi types for loading the Picker library */
declare const gapi: {
  load(api: string, callback: () => void): void;
};

declare namespace google.picker {
  class PickerBuilder {
    constructor();
    addView(view: DocsView | ViewId): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setCallback(callback: (data: PickerCallbackData) => void): PickerBuilder;
    enableFeature(feature: Feature): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    setOrigin(origin: string): PickerBuilder;
    build(): Picker;
  }

  class DocsView {
    constructor(viewId?: ViewId);
    setIncludeFolders(include: boolean): DocsView;
    setMimeTypes(mimeTypes: string): DocsView;
    setSelectFolderEnabled(enabled: boolean): DocsView;
    setMode(mode: DocsViewMode): DocsView;
  }

  interface Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }

  interface PickerCallbackData {
    action: string;
    docs?: PickerDocument[];
  }

  interface PickerDocument {
    id: string;
    name: string;
    mimeType: string;
    url: string;
    sizeBytes?: number;
  }

  enum Action {
    CANCEL = 'cancel',
    PICKED = 'picked',
  }

  enum ViewId {
    DOCS = 'all',
    DOCS_IMAGES = 'docs-images',
    DOCS_VIDEOS = 'docs-videos',
    DOCUMENTS = 'documents',
    SPREADSHEETS = 'spreadsheets',
    PRESENTATIONS = 'presentations',
    FOLDERS = 'folders',
    PDFS = 'pdfs',
  }

  enum Feature {
    MULTISELECT_ENABLED = 'multiselect',
    NAV_HIDDEN = 'navhidden',
    SIMPLE_UPLOAD_ENABLED = 'simple-upload',
    MINE_ONLY = 'mineonly',
    SUPPORT_DRIVES = 'support-drives',
  }

  enum DocsViewMode {
    GRID = 'grid',
    LIST = 'list',
  }
}

declare namespace google.accounts.oauth2 {
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function initCodeClient(config: CodeClientConfig): CodeClient;

  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message: string }) => void;
    prompt?: string;
  }

  interface TokenClient {
    requestAccessToken(overrideConfig?: { prompt?: string }): void;
  }

  interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    error?: string;
    error_description?: string;
  }

  interface CodeClientConfig {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    redirect_uri?: string;
    callback: (response: CodeResponse) => void;
    error_callback?: (error: { type: string; message: string }) => void;
  }

  interface CodeClient {
    requestCode(): void;
  }

  interface CodeResponse {
    code: string;
    scope: string;
    error?: string;
    error_description?: string;
  }
}
