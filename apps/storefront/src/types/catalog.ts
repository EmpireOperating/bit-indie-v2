export type CatalogGame = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  descriptionMd: string | null;
  coverObjectKey: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type FeaturedGame = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  priceSats: number;
  imageAlt: string;
  releaseId?: string | null;
};
