/**
 * ASCII art for the fight screen: monsters, weapons, armor.
 *
 * Twenty-three named enemies map onto ten archetypes by keyword, because the
 * art has to read at a glance inside a 360px frame, not catalogue every lore
 * distinction. Weapons and armor are per-class: the Warrior's sword, the
 * Archer's bow, the Mage's crystal staff. Everything is pure ASCII, sized to
 * sit two-across in the combat panel.
 */

import type { ClassId } from '../engine/types.ts'

/** One art block and the column count to pad the pair against. */
export interface ArtBlock {
  readonly lines: readonly string[]
}

const SPIRIT: ArtBlock = {
  lines: [
    '     .-~~~~~-.',
    '    /  .---.  \\',
    '   ;  / o o \\  ;',
    '   |  |  ^  |  |',
    '   ;  \\ \'-\' /  ;',
    '    \\  \'---\'  /',
    '  ~~~`~~~~~~~\'~~~',
    ' ~~~   ~~~~~~   ~~~',
    '~     ~~    ~~     ~',
    '      ~~~~~~~~',
  ],
}

const SENTINEL: ArtBlock = {
  lines: [
    '      ________',
    '     / ______ \\',
    '    | / o  o \\ |',
    '    | |  ..  | |',
    '    | \\ \\__/ / |',
    '   /|  \'----\'  |\\',
    '  | |_| ______ |_|',
    '  |  | ||      ||',
    '  |__|_||______||_',
    '      /_| |__| |_\\',
  ],
}

const CULTIST: ArtBlock = {
  lines: [
    '       .;^;.',
    '      /:::::\\',
    '      | o o |',
    '      |  ~  |',
    '      \\ \'-\' /',
    '     __|___|__',
    '    /  |   |  \\',
    '   ;   | @ |   ;',
    '    \'.__|___|__.\'',
    '       ||   ||',
  ],
}

const MAGUS: ArtBlock = {
  lines: [
    '         /\\',
    '        /  \\',
    '       /-\'\'-\\',
    '      / /""\\ \\',
    '     | | () | |',
    '     |  \\  /  |',
    '     |  |  |  |',
    '    /|  |  |  |\\',
    '   ; \\_|__|__/ ;',
    '      /_||__||_\\',
  ],
}

const SHADE: ArtBlock = {
  lines: [
    '        .-.',
    '       /   \\',
    '      | ~~~ |',
    '      |(o o)|',
    '      | \\_/ |',
    '       \\___/',
    '      /~~~~~\\',
    '     ; ~~~~~ ;',
    '      ~ ~~ ~~',
    '       ~~ ~~',
  ],
}

const GUARDIAN: ArtBlock = {
  lines: [
    '     \\  |  /',
    "   '.  \\ | /  .'",
    '     \'- \\|/ -\'',
    '     ___  Y  ___',
    '    /   \\ | /   \\',
    '   |_____\\|/_____|',
    '       __|=|__',
    '      /  ===  \\',
    '      \\_______/',
    '    ~~~||   ||~~~',
  ],
}

const TIDE: ArtBlock = {
  lines: [
    '        ___',
    '    ___/   \\___',
    '   /           \\ ___',
    '~~(     ~~      v   ~~',
    ' ~ \\  ~   ~~   /  ~~~',
    '  ~ \\____  ___/ ~~~~',
    ' ~~~~ ~  \\/   ~~~~ ~~~',
    ' ~~~ ~~~~  ~~~ ~~ ~~~~',
    '   ~~ ~~~ ~~ ~~ ~~~',
    '    ~~   ~~~   ~~',
  ],
}

const VESSEL: ArtBlock = {
  lines: [
    '       _____',
    '      /     \\',
    '     /  _ _  \\',
    '    |  ( ) ( )|',
    '    ;    -    ;',
    '    |  \\___/  |',
    '     \\ ||||| /',
    '      \\|||||/',
    '       |:::|',
    '      /__|__\\',
  ],
}

const AVATAR: ArtBlock = {
  lines: [
    '      \\  |  /',
    '    \'\\ \\_|_/ /\'',
    '      \\(o.o)/',
    '       \\|_|/',
    '      /--|--\\',
    '     ; | ^ | ;',
    '       | | |',
    '       | | |',
    '      _|_|_|_',
    '     (_______)',
  ],
}

const CORRUPTION: ArtBlock = {
  lines: [
    '      ,%%,  ,',
    '    ,%%%%%,%%,',
    '   %%%@%%%%%%%,',
    '  %%%%%%,%%%%%%',
    "   '%%%%%%%,%%'",
    '   %%,@%%%%%,%\'',
    "    '%%%%%%%';",
    "    %%'  '%,;",
    '   %;      %',
    '  ~~~~~~~~~~~~',
  ],
}

/** Keyword → archetype. First match wins; checked in specificity order. */
const KEYWORDS: readonly { readonly word: string; readonly art: ArtBlock }[] = [
  { word: 'sentinel', art: SENTINEL },
  { word: 'guardian', art: GUARDIAN },
  { word: 'avatar', art: AVATAR },
  { word: 'vessel', art: VESSEL },
  { word: 'tide', art: TIDE },
  { word: 'shade', art: SHADE },
  { word: 'warden', art: SHADE },
  { word: 'corruption', art: CORRUPTION },
  { word: 'working', art: CORRUPTION },
  { word: 'landslide', art: SENTINEL },
  { word: 'emissary', art: MAGUS },
  { word: 'thessaly', art: MAGUS },
  { word: 'whisper', art: SPIRIT },
  { word: 'hunters', art: CULTIST },
  { word: 'agent', art: CULTIST },
  { word: 'enforcer', art: CULTIST },
  { word: 'choir', art: CULTIST },
]

/** Pick the archetype art for a named enemy; unknown names fall back to the spirit. */
export function artForEnemy(name: string): ArtBlock {
  const lower = name.toLowerCase()
  for (const { word, art } of KEYWORDS) {
    if (lower.includes(word)) return art
  }
  return SPIRIT
}

const SWORD: ArtBlock = {
  lines: [
    '         /\\',
    '        |  |',
    '        |  |',
    '        |  |',
    '        |  |',
    '        |  |',
    '       /|  |\\',
    '      / ==== \\',
    '      \\_||_||_/',
    '        (____)',
  ],
}

const BOW: ArtBlock = {
  lines: [
    '       ,^.',
    '      / | `.',
    '     ;  |  `',
    '     |  |  |',
    '     |  |==|>',
    '     |  |  |',
    '     ;  |  ,',
    '      \\ | ,\'',
    "       \\|,'",
    '        `',
  ],
}

const STAFF: ArtBlock = {
  lines: [
    '        ,^,',
    '       / * \\',
    '      ;  o  ;',
    '       \\ \\ /',
    '        \\|/',
    '        |||',
    '        |||',
    '        |||',
    '        |||',
    '       (___)',
  ],
}

const ARMOR: ArtBlock = {
  lines: [
    '       _____',
    '      /     \\',
    '     || ,-. ||',
    '     || | | ||',
    "     || '-' ||",
    "     |'-----'|",
    '     | _____ |',
    '     |/     \\|',
    "     '\\_____/'",
    '       |   |',
  ],
}

/** The class's weapon art (the armor is shared). */
export function artForClass(classId: ClassId): ArtBlock {
  if (classId === 'warrior') return SWORD
  if (classId === 'archer') return BOW
  return STAFF
}

/** The armor art, shared across classes. */
export function artArmor(): ArtBlock {
  return ARMOR
}
