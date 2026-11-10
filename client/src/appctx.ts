// Props dùng chung cho mọi view.
import type { Account, BootstrapData, Conversation } from './types';

export interface CreateOrderPrefill {
  customerName?: string;
  phone?: string;
  address?: string;
  note?: string;
  conversationId?: string;
  items?: Array<{ productId?: string; sku?: string; color?: string; size?: string; quantity?: number; price?: number }>;
}

export interface AppContext {
  data: BootstrapData;
  account: Account;
  shopKey: string;
  isSuperAdmin: boolean;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
  openCreateOrder: (prefill?: CreateOrderPrefill, conversation?: Conversation) => void;
  channelFocus?: string | null;
}
