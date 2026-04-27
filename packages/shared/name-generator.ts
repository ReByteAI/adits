/**
 * Random project name generator.
 * Generates names like "golden-phoenix", "calm-meadow", "stellar-pearl".
 */

const adjectives = [
  'happy', 'sunny', 'calm', 'brave', 'bright', 'cool', 'swift', 'noble',
  'gentle', 'quiet', 'bold', 'smart', 'kind', 'wise', 'clear', 'fresh',
  'warm', 'golden', 'silver', 'crystal', 'cosmic', 'stellar', 'lunar',
  'royal', 'mystic', 'serene', 'vibrant', 'clever', 'sleek', 'keen',
  'mighty', 'humble', 'grand', 'daring', 'merry', 'jolly', 'lively',
]

const nouns = [
  'cloud', 'moon', 'star', 'sun', 'wave', 'river', 'ocean', 'mountain',
  'forest', 'meadow', 'garden', 'tiger', 'eagle', 'wolf', 'fox', 'owl',
  'phoenix', 'falcon', 'raven', 'dove', 'breeze', 'flame', 'spark',
  'crystal', 'diamond', 'pearl', 'ruby', 'jade', 'amber', 'bloom',
  'petal', 'echo', 'dream', 'spirit', 'arrow', 'crown', 'tower',
]

export function generateProjectName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  return `${adj}-${noun}`
}
