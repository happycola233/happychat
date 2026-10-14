import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CostCurrency } from '@shared/types/domain'

export const useBillingCurrency = create<{
  currency: CostCurrency
  setCurrency: (currency: CostCurrency) => void
}>()(
  persist((set) => ({ currency: 'USD', setCurrency: (currency) => set({ currency }) }), {
    name: 'happychat-billing-currency',
  }),
)
export const getBillingCurrency = (): CostCurrency => useBillingCurrency.getState().currency
