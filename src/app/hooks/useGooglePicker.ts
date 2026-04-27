/**
 * Google Drive Picker hook
 *
 * Opens Google's native Picker UI for file selection.
 * Downloads selected files client-side via Drive API and returns File objects
 * ready for uploadToGcs().
 *
 * Google Docs/Sheets/Slides are exported to Office formats (.docx/.xlsx/.pptx).
 * Regular files are downloaded as-is.
 */

import { useCallback, useRef, useState } from 'react';

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
export const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
export const SCOPES = 'https://www.googleapis.com/auth/drive.file';

export const TOKEN_STORAGE_KEY = 'google_drive_picker_token';
export const TOKEN_EXPIRY_KEY = 'google_drive_picker_token_expiry';

export function getCachedToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() >= Number(expiry)) {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
  }
  return token;
}

export function setCachedToken(token: string, expiresInSeconds: number): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
}

// Google Docs MIME type → export MIME type + file extension
const GOOGLE_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
};

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

let gapiLoaded = false;
let gisLoaded = false;

export async function ensureGapiLoaded(): Promise<void> {
  if (gapiLoaded) return;
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve) => {
    gapi.load('picker', () => {
      gapiLoaded = true;
      resolve();
    });
  });
}

export async function ensureGisLoaded(): Promise<void> {
  if (gisLoaded) return;
  await loadScript('https://accounts.google.com/gsi/client');
  gisLoaded = true;
}

/** Request a Google OAuth token, reusing the cached one if available. */
export function requestGoogleToken(): Promise<string> {
  const cached = getCachedToken();
  if (cached) return Promise.resolve(cached);

  return new Promise<string>((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        setCachedToken(response.access_token, response.expires_in);
        setTimeout(() => {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
        }, response.expires_in * 1000);
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.message || 'OAuth failed'));
      },
    });

    tokenClient.requestAccessToken({ prompt: '' });
  });
}

interface UseGooglePickerOptions {
  onFilesReady: (files: File[]) => void;
}

export function useGooglePicker({ onFilesReady }: UseGooglePickerOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const accessTokenRef = useRef<string | null>(getCachedToken());

  const downloadFile = useCallback(async (
    doc: google.picker.PickerDocument,
    token: string,
  ): Promise<File> => {
    const exportInfo = GOOGLE_EXPORT_MAP[doc.mimeType];

    let response: Response;
    let fileName: string;
    let contentType: string;

    if (exportInfo) {
      // Google Docs/Sheets/Slides → export to Office format
      response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(exportInfo.mime)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      // Strip any existing extension from name and add the export extension
      const baseName = doc.name.replace(/\.[^.]+$/, '');
      fileName = `${baseName}${exportInfo.ext}`;
      contentType = exportInfo.mime;
    } else {
      // Regular file → download as-is
      response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      fileName = doc.name;
      contentType = doc.mimeType;
    }

    if (!response.ok) {
      throw new Error(`Failed to download ${doc.name}: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    return new File([blob], fileName, { type: contentType });
  }, []);

  const openPicker = useCallback(async () => {
    setIsLoading(true);

    try {
      // Load both scripts in parallel
      await Promise.all([ensureGapiLoaded(), ensureGisLoaded()]);

      // Get access token (reuse if we already have one)
      const token = await new Promise<string>((resolve, reject) => {
        if (accessTokenRef.current) {
          resolve(accessTokenRef.current);
          return;
        }

        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            accessTokenRef.current = response.access_token;
            setCachedToken(response.access_token, response.expires_in);
            setTimeout(() => { accessTokenRef.current = null; }, response.expires_in * 1000);
            resolve(response.access_token);
          },
          error_callback: (error) => {
            reject(new Error(error.message || 'OAuth failed'));
          },
        });

        tokenClient.requestAccessToken({ prompt: '' });
      });

      // Build and show picker
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
      view.setIncludeFolders(false);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setTitle('Select files from Google Drive')
        .setOrigin(window.location.origin)
        .setCallback(async (data) => {
          if (data.action === google.picker.Action.PICKED && data.docs) {
            // Download all selected files in parallel
            const files = await Promise.all(
              data.docs.map((doc) => downloadFile(doc, token)),
            );
            onFilesReady(files);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (error) {
      console.error('[GooglePicker] Error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [onFilesReady, downloadFile]);

  return { openPicker, isLoading };
}
