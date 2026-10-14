# Attachment references in v2

The v2 cache stores lightweight provider references, not media bytes. It indexes each non-bot upload by chat and owner, and separately by chat and message ID. Both references expire after ten minutes. PDF collection state is separately keyed by chat and sender, held in memory for twenty minutes, and capped at twenty files.

Attachment caching is best-effort when the bounded `TtlStore` is full. The pipeline preflights both reference slots and writes neither if both cannot fit; an unexpected second-write failure restores only the keys touched by that attempt. It does not evict other state. A directed command carrying media can still process that message's current attachment through an ephemeral context reference. That fallback is not cached, so later messages cannot treat it as historical context. An unaddressed group upload remains silent and only gets a follow-up reference if both cache entries were stored.

The cache and PDF collections are in-memory. A restart intentionally drops them, so a user cannot continue an attachment follow-up or unfinished collection across restart. Persisting either requires a separate decision about storage, cleanup, and compatibility; the legacy fifteen-minute attachment TTL is not carried over.
