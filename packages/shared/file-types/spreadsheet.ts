import { FileType, type FileTypeSpec } from './types'

export const SHEET_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>'

export const SpreadsheetSpec: FileTypeSpec = {
  key: 'excel',
  fileType: FileType.Office,
  label: 'Spreadsheet',
  extensions: ['.xlsx', '.xls', '.csv', '.tsv'],
  mimePatterns: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  needsThumb: false,
  needsSrc: true,  // SheetJS parses the workbook blob in the browser
  icon: SHEET_ICON,
  templates: ['Summarize the data', 'Create a chart', 'Convert to CSV', 'Find anomalies'],
  placeholder: () => 'Tell us what to do with this spreadsheet…',
}
