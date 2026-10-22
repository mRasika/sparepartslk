import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireUser } from "@/server/auth";
import { listBrands, listCategories, listVehicleModels } from "@/server/services/catalog";
import { BrandEditor, CategoryEditor, VehicleModelEditor } from "./editors";

export default async function PartSettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="part settings" />;
  const [categories, brands, vehicleModels] = await Promise.all([
    listCategories(),
    listBrands(),
    listVehicleModels(),
  ]);

  return (
    <div>
      <PageHeader title="Categories, brands and bike models" description="Used to organise and filter parts." />
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="models">Bike models</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="pt-4">
          <CategoryEditor rows={categories} />
        </TabsContent>
        <TabsContent value="brands" className="pt-4">
          <BrandEditor rows={brands} />
        </TabsContent>
        <TabsContent value="models" className="pt-4">
          <VehicleModelEditor rows={vehicleModels} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
