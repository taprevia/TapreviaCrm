export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '919876543210';

export interface WhatsAppOrderParams {
  productName?: string;
  price?: number;
  customMessage?: string;
}

/**
 * Generates a direct WhatsApp link with a pre-filled message for product order or inquiry.
 */
export function getWhatsAppUrl({ productName, price, customMessage }: WhatsAppOrderParams = {}): string {
  const cleanNumber = WHATSAPP_NUMBER.replace(/[^0-9]/g, '');

  let text = '';
  if (customMessage) {
    text = customMessage;
  } else if (productName && price !== undefined) {
    text = `Hello Taprevia team! 👋\n\nI would like to purchase:\n📦 *Product:* ${productName}\n💰 *Price:* ₹${price}\n\nPlease share the payment & delivery details to confirm my order.`;
  } else if (productName) {
    text = `Hello Taprevia team! 👋\n\nI am interested in ordering *${productName}*. Please provide pricing and customization options!`;
  } else {
    text = `Hello Taprevia team! 👋\n\nI'm visiting your website and would like to buy an NFC card / Standy. Can you help me choose the right product?`;
  }

  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}

/**
 * Opens WhatsApp in a new tab with the formatted message.
 */
export function openWhatsAppOrder(params: WhatsAppOrderParams = {}): void {
  const url = getWhatsAppUrl(params);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
