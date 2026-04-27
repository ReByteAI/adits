import { FileType, type FileTypeSpec } from './types'

export const IMAGE_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'

export const ImageSpec: FileTypeSpec = {
  key: 'image',
  fileType: FileType.Image,
  label: 'Image',
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.heic', '.avif', '.bmp', '.tiff', '.tif'],
  mimePatterns: ['image/*'],
  needsThumb: true,
  needsSrc: false,
  icon: IMAGE_ICON,
  templates: ['Remove the background', 'Make it brighter', 'Upscale to 2x', 'Crop and resize', 'Convert to PNG'],
  placeholder: () => 'Describe how to edit this image…',
}
