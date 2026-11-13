# What's changed

This page lists the changes to nys-openlegislation-mcp that a reader would notice: new tools, tools that started working, and corrections when the server gave a wrong answer. Newest first. Dates are New York dates; CHANGELOG.md gives some releases the next day's date, in UTC.

- **History begins:** 2026-05-21, the first release. Corrections made before this date may be missing.
- **Data refresh:** The server asks the New York State Senate's Open Legislation API each time. If you keep a local copy of the data, it is as current as your last sync, and answers from it say when that was.

To report a bug in this server or ask for a new feature, [open an issue on GitHub](https://github.com/BetaNYC/nys-openlegislation-mcp/issues).

## Unreleased: Two tools that explain the server and list what changed

- **Tags:** MCP
- **What changed:** Two new tools let your AI assistant answer "what changed in this server?" from this page, and "who built this?" with links to BetaNYC and to the place to report a bug in this server or ask for a new feature. This page is new too. It lists the changes a reader would notice, back to the first release.
- **MCP version:** [nys-openlegislation-mcp 2.6.0](CHANGELOG.md)
- **More detail:** [Release notes](CHANGELOG.md)

## 2026-10-22: Links to law sections on the Senate's website, and result totals

- **Tags:** MCP
- **What changed:** A law section or article from the server now comes with a link to its page on nysenate.gov, so your AI assistant does not have to guess one. Live search and list answers now say how many results there are in all, so you can tell a full page from the last one.
- **MCP version:** [nys-openlegislation-mcp 2.5.0](CHANGELOG.md#250---2026-10-22)
- **More detail:** [Release notes](CHANGELOG.md#250---2026-10-22) · [The issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/18) · [The pull request](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/23)

## 2026-10-11: Searches ignored the session year, and member lookups could cross chambers

- **Tags:** MCP, Correction
- **What changed:** Until October 11, 2026, a bill search for one session returned bills from every session: a search for "lobbying" in the 2025 session returned bills from 2009, 2011 and 2013. Looking up a member in the Senate could return an Assembly member with no error, and a member search ignored the chamber. Version 2.4.0 searches only the session you ask for and reports a chamber mismatch as an error naming the member's real chamber.
- **If you used the old numbers:** If you searched bills for a session year before October 11, 2026, or searched without a year expecting the current session, check the session of each bill you used, or run the search again with the year. The report that found this had a search for "lobbying" in the 2025 session return 616 bills, where the 2025 session has 95. A search without a year still covers every session. If you looked up a legislator by chamber, check that the member's chamber is the one you asked for.
- **MCP version:** [nys-openlegislation-mcp 2.4.0](CHANGELOG.md#240---2026-10-11)
- **More detail:** [The session year issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/21) · [The member issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/17) · [The fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/22)

## 2026-10-11: Vote lookups work, and member search works without an API key

- **Tags:** MCP
- **What changed:** The tool for a bill's votes failed for every bill until this release; it now returns the votes recorded on the bill. Member search can now answer from a local copy of the data, including without an API key, and each result gives the member's full name and chamber.
- **MCP version:** [nys-openlegislation-mcp 2.4.0](CHANGELOG.md#240---2026-10-11)
- **More detail:** [The votes issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/20) · [Release notes](CHANGELOG.md#240---2026-10-11)

## 2026-07-21: The server starts without an API key when it has a local copy of the data

- **Tags:** MCP
- **What changed:** Without an API key, the server used to stop at startup even when a local copy of the data was on disk. Now it serves that copy, says how old it is and what would refresh it, and says so when something is not in the copy rather than saying it does not exist. Tools that need the live API say they need a key. CHANGELOG.md dates this release July 22, in UTC.
- **MCP version:** [nys-openlegislation-mcp 2.3.0](CHANGELOG.md#230---2026-07-22)
- **More detail:** [The issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/13) · [Release notes](CHANGELOG.md#230---2026-07-22)

## 2026-07-21: Tools ignored settings they did not have, without saying so

- **Tags:** MCP, Correction
- **What changed:** From May 21 to July 21, 2026, when an AI assistant passed a setting a tool does not have, the tool dropped it without saying so. The answer looked right but could answer a different question. Version 2.3.0 refuses the call and names the settings the tool does accept.
- **If you used the old numbers:** We know of no wrong answer this caused. If you asked a question then that named something a tool could not filter on, ask it again with the current version.
- **MCP version:** [nys-openlegislation-mcp 2.3.0](CHANGELOG.md#230---2026-07-22)
- **More detail:** [The issue](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/11) · [The fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/12)

## 2026-07-07: A local copy had no law sections, and law contents came back as a placeholder

- **Tags:** MCP, Data, Correction
- **What changed:** Until July 6, 2026, asking for a law's table of contents from a local copy returned a placeholder with the law's name instead of its contents; version 2.1.0 reads the real table of contents, and asks the live API when the copy does not have it. Until July 7, the repository's script for building a local copy kept only the top entry of each of the 137 laws, with no sections and no section text, even when asked for the text. Version 2.1.1 fixes the script.
- **If you used the old numbers:** This affected only people who kept a local copy of the data. If you built yours before July 7, 2026, rebuild its laws with node scripts/fetch-data.js --types=laws, adding --include-law-text if you want section text; the regular sync does not update laws. If you used a law's table of contents or a law section from a local copy before then, check it on nysenate.gov.
- **Who it affects:** People who built a local copy of the data with the repository's scripts.
- **MCP version:** [nys-openlegislation-mcp 2.1.1](CHANGELOG.md#211---2026-07-07)
- **More detail:** [The script fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/9) · [Release notes for 2.1.1](CHANGELOG.md#211---2026-07-07) · [Release notes for 2.1.0](CHANGELOG.md#210---2026-07-06)

## 2026-07-06: A local copy could hide newer data and keep an old version of an amended bill

- **Tags:** MCP, Data, Correction
- **What changed:** From May 26 to July 6, 2026, when the local copy of the data had no results for a question, the server answered with nothing instead of asking the live API. When a bill was amended, the local copy kept the bill's old version under its original number. Version 2.1.0 asks the live API when the local copy has nothing, keeps amended bills current, and labels every answer from the local copy with the date of its last sync.
- **If you used the old numbers:** This affected only people who kept a local copy of the data. If you got an empty answer in that period, ask again with the current version. For a bill that had been amended, check its current amendment letter and text on nysenate.gov. A sync does not clear what the old version left behind: it refreshes a bill under its original number only when the bill changes again, and keeps any row saved under the amended number, such as S1234A. To clear them, build a new local copy: move data/corpus.db aside (or the file NYS_CORPUS_DB names, if you set it) and run node scripts/fetch-data.js.
- **Who it affects:** People who built a local copy of the data with the repository's scripts.
- **MCP version:** [nys-openlegislation-mcp 2.1.0](CHANGELOG.md#210---2026-07-06)
- **More detail:** [The fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/6) · [Release notes](CHANGELOG.md#210---2026-07-06)

## 2026-07-06: Search, transcripts and member lookups work

- **Tags:** MCP
- **What changed:** Until July 6, 2026, the search tool failed on every query, and the transcript tools and the member lookup asked the API for addresses that do not exist. Versions 2.0.1 and 2.1.0, released that day, use the routes in the Open Legislation documentation. The tool for recent changes can now be limited to bills, agendas, calendars or laws.
- **MCP version:** [nys-openlegislation-mcp 2.1.0](CHANGELOG.md#210---2026-07-06)
- **More detail:** [The search fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/7) · [The transcript and member fix](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/6) · [Release notes](CHANGELOG.md#201---2026-07-06)

## 2026-05-26: An optional local copy of the data

- **Tags:** MCP, Data
- **What changed:** You can keep a copy of bills, laws, members, committees, calendars, agendas and transcripts on your own computer and refresh it with a nightly sync. The server answers from that copy first and asks the live API for anything it does not have.
- **MCP version:** [nys-openlegislation-mcp 2.0.0](CHANGELOG.md#200---2026-05-26)
- **More detail:** [How to set it up](README.md#local-corpus-optional) · [The pull request](https://github.com/BetaNYC/nys-openlegislation-mcp/pull/2)

## 2026-05-21: First release: bills, laws, members and more from the State Legislature

- **Tags:** MCP
- **What changed:** The first version on npm gave AI assistants tools for New York State bills, laws, members, committees, floor calendars, committee agendas, transcripts, recent changes and search, from the Senate's Open Legislation API. The next day, versions 1.0.1 and 1.0.2 added a link to each bill's page on nysenate.gov. It reached npm on the evening of May 21 in New York; CHANGELOG.md lists it as 2026-05-22, the date in UTC.
- **MCP version:** [nys-openlegislation-mcp 1.0.0](CHANGELOG.md#100---2026-05-22)
- **More detail:** [Release notes](CHANGELOG.md#100---2026-05-22) · [The package on npm](https://www.npmjs.com/package/@betanyc/nys-openlegislation-mcp)
