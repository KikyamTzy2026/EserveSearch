# Doc Name Finder

Static site for the Must Use Mail Playbook. Type a document title and get:

- the matched playbook document name
- the file name in the playbook's `Date / File number / Name` format (fill in the date and file number)
- mail and email routing, Lit Process and any additional step
- the client's answered-queries rule for similar titles, and notes-sheet hints
- a "needs review" warning for anything under 80% match (nothing is guessed)

No server, no API keys, no build step.

## Deploy on Vercel

1. Put this folder in a Git repo and import it at vercel.com/new, **or** run `npx vercel` inside the folder.
2. Framework preset: **Other**. `vercel.json` already sets the output directory to `public` and skips the build.
3. Deploy.

## Update the playbook

Quickest: open the site, go to **My data**, and upload the new .xls/.xlsx. It is saved in that browser only.

To update the site for everyone:

```bash
npm install
node scripts/build-data.mjs "path/to/New Playbook.xls"
```

This rewrites `public/data/playbook.json`. Commit and push.

## Local preview

```bash
npm run dev
```

## Notes

- The main foreclosure sheet is the dated one (for example `2.7.26`). The older foreclosure sheet is available behind a checkbox.
- Client answers are parsed from free text. Lines that cannot be split into a title and a routing instruction are shown as written.
- Files: `public/app.js` (interface), `public/search.js` (matching), `public/parse.js` (spreadsheet parsing, shared with `lib/`).
