# Architecture rules

- Keep MAG grouping and output ordering in the browser-safe MAG converter, with regression tests alongside it, so uploads and downloads share the same rules without sending spreadsheet data to a server.
- Keep Bradesco, Sul America and Prudential parsing plus apólice/% grouping in the browser-safe insurer converter (PDF text via pdfjs loaded on demand), with tests alongside, so statements never leave the browser.
