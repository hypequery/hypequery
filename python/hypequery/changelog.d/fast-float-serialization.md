- Float measures serialize about 65 times faster, with byte-identical output.
  Python serve's NDJSON streams spent nearly all their time formatting float
  measures as strings: streaming 1M rows took 44 s and now takes about 4 s,
  on a par with TypeScript serve. JSON pages, MCP results and canonical
  protocol values use the same serializer and get the same speedup.
