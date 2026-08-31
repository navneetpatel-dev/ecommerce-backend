import { PDF_PAGE } from './pdfTheme';
import {
  drawPdfContinuedHeader,
  drawPdfFirstHeader,
  drawPdfFooter,
  paintPaper,
} from './pdfChrome';

export class PdfPageLayout {
  readonly doc: PDFKit.PDFDocument;
  readonly margin = PDF_PAGE.margin;
  readonly contentWidth: number;
  y = 0;
  private readonly pageBottom: number;
  private readonly title: string;
  private readonly continuationTitle?: string;

  constructor(
    doc: PDFKit.PDFDocument,
    title: string,
    continuationTitle?: string,
  ) {
    this.doc = doc;
    this.title = title;
    this.continuationTitle = continuationTitle;
    this.contentWidth = doc.page.width - this.margin * 2;
    this.pageBottom = doc.page.height - PDF_PAGE.footerH - 8;
  }

  get pageBottomY(): number {
    return this.pageBottom;
  }

  startPage(first = true) {
    paintPaper(this.doc);
    if (first) {
      drawPdfFirstHeader(this.doc, this.title);
      this.y = PDF_PAGE.headerH + PDF_PAGE.goldH + 18;
    } else {
      drawPdfContinuedHeader(
        this.doc,
        this.continuationTitle ?? this.title,
      );
      this.y = PDF_PAGE.continuedHeaderH;
    }
    drawPdfFooter(this.doc);
  }

  ensure(needed: number) {
    if (this.y + needed > this.pageBottom) this.addPage();
  }

  addPage() {
    this.doc.addPage();
    this.startPage(false);
  }
}
