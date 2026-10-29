/**
 * XMP metadata for PDF/X-4 (ISO 15930-7 §6.7.11). Values must agree with the
 * document Info dictionary: Title, Producer, CreationDate/ModDate, Trapped.
 */
export interface XmpInput {
  title: string;
  date: Date;
  documentId: string;
  producer: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Info-dictionary date: D:YYYYMMDDHHmmSS+00'00' (always UTC). */
export function pdfDate(d: Date): string {
  return `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+00'00'`;
}

/** XMP date: ISO 8601 with an explicit offset, matching pdfDate. */
export function xmpDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildXmp(x: XmpInput): string {
  const date = xmpDate(x.date);
  const id = x.documentId.toLowerCase();
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  return `<?xpacket begin="\u{FEFF}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(x.title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreateDate>${date}</xmp:CreateDate>
   <xmp:ModifyDate>${date}</xmp:ModifyDate>
   <xmp:MetadataDate>${date}</xmp:MetadataDate>
   <xmp:CreatorTool>${esc(x.producer)}</xmp:CreatorTool>
   <pdf:Producer>${esc(x.producer)}</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
   <xmpMM:DocumentID>uuid:${uuid}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${uuid}</xmpMM:InstanceID>
   <xmpMM:VersionID>1</xmpMM:VersionID>
   <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
