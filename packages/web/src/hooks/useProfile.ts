import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface CompanyProfile {
  company_name: string | null;
  company_description: string | null;
  company_products: string | null;
  company_icp: string | null;
  company_differentiators: string | null;
  company_competitors: string | null;
  company_methodology: string | null;
  company_tone: string | null;
}

export function useCompanyProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<{ profile: CompanyProfile }>("/profile"),
  });
}

export function useSaveCompanyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, string | null>) =>
      api.put<{ ok: boolean }>("/profile", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
