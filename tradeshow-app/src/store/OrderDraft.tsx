import React, { createContext, useCallback, useContext, useState } from 'react';
import { Customer, OrderLine, Product } from '../types';

// Holds the in-progress order as the rep moves Customer -> Products -> Review.
// Reset when a new order starts or an order is submitted.

interface DraftState {
  customer: Customer | null;
  lines: OrderLine[];
  notes: string;
  emailConfirmation: boolean;
  setEmailConfirmation: (v: boolean) => void;
  setCustomer: (c: Customer | null) => void;
  addProduct: (p: Product) => void;
  setQuantity: (productId: string, qty: number) => void;
  setDiscount: (productId: string, pct: number) => void;
  removeLine: (productId: string) => void;
  setNotes: (n: string) => void;
  reset: () => void;
}

const Ctx = createContext<DraftState | undefined>(undefined);

export function OrderDraftProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [notes, setNotes] = useState('');
  const [emailConfirmation, setEmailConfirmation] = useState(true);

  const addProduct = useCallback((p: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      const line: OrderLine = {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unitPrice: p.price,
        quantity: 1,
        discountPct: 0,
        imageUri: p.imageUri ?? null,
      };
      return [...prev, line];
    });
  }, []);

  const setQuantity = useCallback((productId: string, qty: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: Math.max(0, qty) } : l))
        .filter((l) => l.quantity > 0)
    );
  }, []);

  const setDiscount = useCallback((productId: string, pct: number) => {
    const clamped = Math.min(100, Math.max(0, pct));
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, discountPct: clamped } : l))
    );
  }, []);

  const removeLine = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const reset = useCallback(() => {
    setCustomer(null);
    setLines([]);
    setNotes('');
    setEmailConfirmation(true);
  }, []);

  const value: DraftState = {
    customer,
    lines,
    notes,
    emailConfirmation,
    setEmailConfirmation,
    setCustomer,
    addProduct,
    setQuantity,
    setDiscount,
    removeLine,
    setNotes,
    reset,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft(): DraftState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDraft must be used within OrderDraftProvider');
  return ctx;
}
