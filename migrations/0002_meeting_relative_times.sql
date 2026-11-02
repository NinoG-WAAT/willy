-- 0002: make transcript_segment.start_ms / end_ms meeting-relative (issue #88).
--
-- Until now the transcription job stored the times a provider reports for ONE chunk (0:00 at the
-- start of every chunk). From now on they are measured from the start of the meeting's audio:
-- chunk offset (sum of duration_ms of all chunks with a lower seq in the same meeting) + time in
-- the chunk. This file repairs the rows written before the fix. It touches start_ms and end_ms
-- only (not updated_at, text or any other column) and moves both by the same amount, so
-- CHECK (end_ms >= start_ms) keeps holding.
--
-- Safe on a database that already has meeting times, and safe to run twice: a chunk is shifted only
-- when its earliest segment starts before the chunk's own offset. That cannot happen once the
-- chunk is meeting-relative (every time is then >= offset), so repaired and post-fix chunks are
-- never shifted again. Chunk 0 has offset 0 and never changes. Known limit: a still chunk-relative
-- chunk whose earliest segment starts at or after its own offset (a long silence at the start of
-- a chunk that follows only short chunks) looks meeting-relative and is left as it is.
--
-- The decision is written to a scratch table first (not read from transcript_segment while it is
-- being updated, which would flip chunks half way through). Offsets only read audio_chunk, which
-- this file never changes. Rows of one meeting are compared with each other only (meeting_id).

DROP TABLE IF EXISTS transcript_time_repair;

CREATE TABLE transcript_time_repair (
  meeting_id TEXT NOT NULL,
  chunk_seq  INTEGER NOT NULL,
  offset_ms  INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, chunk_seq)
);

INSERT INTO transcript_time_repair (meeting_id, chunk_seq, offset_ms)
SELECT c.meeting_id, c.seq,
       (SELECT SUM(p.duration_ms) FROM audio_chunk p
         WHERE p.meeting_id = c.meeting_id AND p.seq < c.seq)
FROM audio_chunk c
WHERE (SELECT SUM(p.duration_ms) FROM audio_chunk p
        WHERE p.meeting_id = c.meeting_id AND p.seq < c.seq) > 0
  AND (SELECT MIN(s.start_ms) FROM transcript_segment s
        WHERE s.meeting_id = c.meeting_id AND s.chunk_seq = c.seq)
      < (SELECT SUM(p.duration_ms) FROM audio_chunk p
          WHERE p.meeting_id = c.meeting_id AND p.seq < c.seq);

UPDATE transcript_segment
SET start_ms = start_ms + (SELECT r.offset_ms FROM transcript_time_repair r
                           WHERE r.meeting_id = transcript_segment.meeting_id
                             AND r.chunk_seq = transcript_segment.chunk_seq),
    end_ms   = end_ms   + (SELECT r.offset_ms FROM transcript_time_repair r
                           WHERE r.meeting_id = transcript_segment.meeting_id
                             AND r.chunk_seq = transcript_segment.chunk_seq)
WHERE EXISTS (SELECT 1 FROM transcript_time_repair r
              WHERE r.meeting_id = transcript_segment.meeting_id
                AND r.chunk_seq = transcript_segment.chunk_seq);

DROP TABLE transcript_time_repair;
