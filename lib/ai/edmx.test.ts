import { describe, it, expect } from 'vitest'
import { isEdmx, edmxToSummary } from './edmx'
import { condenseApiMaterials } from './api-materials'

const V2 = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <Schema Namespace="API_BATCH_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="BatchType">
     <Key><PropertyRef Name="Material"/><PropertyRef Name="Batch"/></Key>
     <Property Name="Material" Type="Edm.String" Nullable="false" MaxLength="18"/>
     <Property Name="Batch" Type="Edm.String" Nullable="false" MaxLength="10"/>
     <Property Name="ShelfLifeExpirationDate" Type="Edm.DateTime"/>
   </EntityType>
   <EntityContainer Name="Container" m:IsDefaultEntityContainer="true">
     <EntitySet Name="Batch" EntityType="API_BATCH_SRV.BatchType"/>
     <FunctionImport Name="CancelBatch" ReturnType="API_BATCH_SRV.BatchType" m:HttpMethod="POST">
       <Parameter Name="Material" Type="Edm.String"/>
     </FunctionImport>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`

const V4 = `<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
 <edmx:DataServices>
  <Schema Namespace="com.sap.X" xmlns="http://docs.oasis-open.org/odata/ns/edm">
   <EntityType Name="Order"><Key><PropertyRef Name="OrderID"/></Key>
     <Property Name="OrderID" Type="Edm.String"/><Property Name="Qty" Type="Edm.Decimal"/></EntityType>
   <EntityContainer Name="C">
     <EntitySet Name="Orders" EntityType="com.sap.X.Order"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`

describe('EDMX ($metadata) ingestion', () => {
  it('detects EDMX', () => { expect(isEdmx(V2)).toBe(true); expect(isEdmx(V4)).toBe(true); expect(isEdmx('{"openapi":"3.0.0"}')).toBe(false) })
  it('parses V2: entity sets, keys, function imports, version', () => {
    const r = edmxToSummary(V2)!; expect(r.odataVersion).toBe('2')
    const paths = r.summary.endpoints.map(e => `${e.method} ${e.path}`)
    expect(paths).toContain('GET /Batch')
    expect(paths.some(p => p.includes("/Batch(Material='{Material}',Batch='{Batch}')"))).toBe(true)
    expect(paths).toContain('POST /CancelBatch')
    expect(r.summary.endpoints.find(e => e.path === '/Batch')!.summary).toContain('keys: Material, Batch')
  })
  it('parses V4 and resolves base from the $metadata URL', () => {
    const r = edmxToSummary(V4, 'https://sap.acme.com/odata/v4/svc/$metadata')!
    expect(r.odataVersion).toBe('4')
    expect(r.summary.suggestedBaseUrl).toBe('https://sap.acme.com/odata/v4/svc')
    expect(r.summary.endpoints.map(e => e.path)).toContain('/Orders')
  })
  it('condenseApiMaterials routes EDMX through and adds OData conventions', () => {
    const out = condenseApiMaterials(`===== metadata.xml =====\n${V2}`)!
    expect(out).toContain('OData $metadata')
    expect(out).toContain('GET /Batch')
    expect(out).toContain('OData V2')
    expect(out.length).toBeLessThan(V2.length + 600)
  })
})
