import QRCode from 'qrcode';

export interface QRGenerateOptions {
  url: string;
  foreground?: string;
  background?: string;
  width?: number;
  margin?: number;
}

export async function generateQRCanvas(
  canvas: HTMLCanvasElement,
  options: QRGenerateOptions
): Promise<void> {
  const {
    url,
    foreground = '#000000',
    background = '#FFFFFF',
    width = 256,
    margin = 2,
  } = options;

  await QRCode.toCanvas(canvas, url, {
    width,
    margin,
    color: {
      dark: foreground,
      light: background,
    },
  });
}

export async function generateQRDataURL(options: QRGenerateOptions): Promise<string> {
  const {
    url,
    foreground = '#000000',
    background = '#FFFFFF',
    width = 256,
    margin = 2,
  } = options;

  return QRCode.toDataURL(url, {
    width,
    margin,
    color: {
      dark: foreground,
      light: background,
    },
  });
}

export async function generateQRSVG(options: QRGenerateOptions): Promise<string> {
  const {
    url,
    foreground = '#000000',
    background = '#FFFFFF',
    width = 256,
    margin = 2,
  } = options;

  return QRCode.toString(url, {
    type: 'svg',
    width,
    margin,
    color: {
      dark: foreground,
      light: background,
    },
  });
}

export function downloadQRAsPNG(canvas: HTMLCanvasElement, filename: string = 'qr-code.png'): void {
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadQRAsSVG(svgString: string, filename: string = 'qr-code.svg'): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
