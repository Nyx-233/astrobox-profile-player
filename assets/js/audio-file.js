/** Load one complete MP3 so media seeking never depends on remote Range support. */
export async function loadAudioFile(source, request = fetch) {
  const response = await request(source, { cache: 'no-store' });
  if (!response.ok) throw new Error('Audio HTTP ' + response.status);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error('Empty audio file');
  // Never turn a cached metadata-only / partial response into the playback file.
  if (response.status === 206) {
    const range = response.headers.get('Content-Range')?.match(/^bytes 0-(\d+)\/(\d+)$/i);
    if (!range || Number(range[1]) + 1 !== Number(range[2]) || bytes.byteLength !== Number(range[2])) {
      throw new Error('Incomplete audio response');
    }
  }
  return { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) };
}
