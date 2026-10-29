/**
 * The transparency group trap (design guide §11.4). Every fill can be
 * DeviceCMYK with a correct CMYK output intent and the file still fails
 * PDF/X-4, because a page's transparency group colour space defaults to
 * DeviceRGB. ISO 15930-7 requires the blending space to be consistent with
 * the output intent, so every page group — and every Form XObject group, if
 * one is ever added — is created through this function.
 *
 * This is the first thing to check when a printer rejects a file.
 */
export function transparencyGroup(): string {
  return "<< /Type /Group /S /Transparency /CS /DeviceCMYK /I true >>";
}
