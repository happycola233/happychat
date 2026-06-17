import { useQuery } from '@tanstack/react-query'
import { listModels } from '../api/models'

export function useModels() {
  return useQuery({ queryKey: ['models'], queryFn: listModels })
}
