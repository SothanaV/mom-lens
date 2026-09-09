# Lens (Mirantis) — reference palette (extracted from installed app.asar `@lensapp/theme`)

Dark-theme values below (the second value in each pair is Lens's light theme, kept for reference).
We match **layout** 1:1 with our own polish, and use these real colors as the base of `theme.css`.

| token | dark | light | usage |
| --- | --- | --- | --- |
| primary (accent) | `#3d90ce` | — | links, active, focus |
| accent-hover / link-hover | `#55a6e2` | — | hovers |
| grey100 (deepest) | `#181A1C` | `#ededed` | app canvas / dock / logs |
| grey80 | `#1F2123` | `#F8F8F8` | sidebar / status bar |
| grey70 | `#26292B` | `#E0E0E0` | deep panels |
| grey60 | `#2D2F31` | `#C3C3C3` | secondary bg |
| grey40 / grey70 | `#26292B` | `#C9C6C1` | nav/panel |
| grey30 | `#414348` | `#BEBEB7` | borders/raised |
| settings/nav selected | `#262b2e` | `#e8e8e8` | selected row/nav |
| sidebar item hover | `#3a3e44` | `#f0f2f5` | nav hover |
| nav hover | `#2e3135` | `#dcddde` | nav hover |
| contentColor (text) | `#e8e8e8` | `#262b2f` | primary text |
| textColorSecondary | `#a0a0a0` | `#51575d` | secondary text |
| borderFaint | `#373a3e` | `#c3c3c3` | soft borders |
| table stripe | `#2a2d33` | `#f8f8f8` | zebra rows |
| table selected | `#37383e` | `#e8e8e8` | selected row |
| scrollBar | `#414349` / hover `#64656a` | `#bbb`/`#a6a6a6` | scrollbars |
| logsBackground | `#000000` | `#ffffff` | log viewer (near-black) |
| success | `#4caf50` | — | Running/Ready |
| warning | `#ff9800` | — | Pending/warn |
| notice | `#ffd572` | — | info notice |
| critical (error) | `#ce3933` / soft `#e85555` | — | Failed/Error |
| colorInfo | `#2d71a4` | — | info |
| gold | `#ffc63d` | — | accents |
| magenta | `#c93dce` | — | accents |

Roundness: Lens uses small radii (~2–4px). Font: system UI sans + a mono stack; base ~13px.
Our `theme.css` `:root` maps these to `--bg/--bg-elev/--bg-deep/--text/--accent/...`.
