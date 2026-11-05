- Server-fault errors (`internal`, `unavailable`) keep the reason they were
  raised with as `CompiledQueryError.diagnostic`, shown in tracebacks; the
  public message is unchanged. A relationship whose target dataset is missing
  from the client's registry now names the dataset and how to register it,
  instead of only "The query could not be executed."
