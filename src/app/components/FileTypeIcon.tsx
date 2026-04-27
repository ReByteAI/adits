import { getType } from '../file-types'

interface FileTypeIconProps {
  type: string
  className?: string
}

export default function FileTypeIcon({ type, className }: FileTypeIconProps) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: getType(type).icon }} />
}
