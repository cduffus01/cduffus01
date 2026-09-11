declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  const pdfParse: (data: Buffer) => Promise<PdfParseResult>;
  export default pdfParse;
}
