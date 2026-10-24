import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { DataService } from './data.service';

const STATUS = z.enum(['ACTIVE', 'DISCONTINUED', 'BANNED', 'RECALLED']);
const ENTITY = z.enum(['PRODUCT', 'RETAILER', 'DISTRIBUTOR']);
const ProductFilter = z.object({ q: z.string().max(60).optional(), status: STATUS.optional() });
const SetStatus = z.object({ status: STATUS, note: z.string().trim().max(300).optional() });
const Control = z.object({ schedule: z.enum(['NONE', 'H', 'H1', 'X']), ndps: z.boolean() });
const Alias = z.object({ alias: z.string().max(80) });
const Barcode = z.object({ code: z.string().max(20) });
const FieldFilter = z.object({ entity: ENTITY.optional() });
const NewField = z.object({
  entity: ENTITY,
  label: z.string().trim().min(2, 'Give the field a name').max(60),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'YESNO', 'CHOICE']),
  options: z.array(z.string().max(60)).max(30).optional(),
  required: z.boolean().optional(),
});
const EditField = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  options: z.array(z.string().max(60)).max(30).optional(),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
const Extra = z.object({ values: z.record(z.union([z.string().max(300), z.number(), z.boolean(), z.null()])) });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31').nullable().optional();
const Licence = z.object({ dl20bExpiry: DATE, dl21bExpiry: DATE, drugLicenceExpiry: DATE });

/** Master data: medicines (status, other names, barcodes), custom fields, licence dates, change history. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_ROLES)
@Controller('admin')
export class DataController {
  constructor(private readonly data: DataService) {}

  @Get('products')
  products(@Query(new ZodPipe(ProductFilter)) f: z.infer<typeof ProductFilter>) {
    return this.data.products(f);
  }

  @Get('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string) {
    return this.data.product(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('products/:id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SetStatus)) b: z.infer<typeof SetStatus>) {
    return this.data.setStatus(u, id, b.status, b.note);
  }

  /** Drug schedule and the narcotic (NDPS) flag. Schedule X and narcotic medicines can never be ordered. */
  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('products/:id/control')
  setControl(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Control)) b: z.infer<typeof Control>) {
    return this.data.setControl(u, id, b.schedule, b.ndps);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('products/:id/aliases')
  addAlias(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Alias)) b: z.infer<typeof Alias>) {
    return this.data.addAlias(u, id, b.alias);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Delete('products/:id/aliases/:aliasId')
  removeAlias(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('aliasId', ParseUUIDPipe) aliasId: string) {
    return this.data.removeAlias(u, id, aliasId);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('products/:id/barcodes')
  addBarcode(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Barcode)) b: z.infer<typeof Barcode>) {
    return this.data.addBarcode(u, id, b.code);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Delete('products/:id/barcodes/:code')
  removeBarcode(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('code') code: string) {
    return this.data.removeBarcode(u, id, code);
  }

  // ---------------- custom fields
  @Get('fields')
  fields(@Query(new ZodPipe(FieldFilter)) f: z.infer<typeof FieldFilter>) {
    return this.data.fields(f.entity);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('fields')
  createField(@CurrentUser() u: AuthUser, @Body(new ZodPipe(NewField)) b: z.infer<typeof NewField>) {
    return this.data.createField(u, b);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Patch('fields/:id')
  updateField(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EditField)) b: z.infer<typeof EditField>) {
    return this.data.updateField(u, id, b);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Put('extra/:entity/:id')
  setExtra(@CurrentUser() u: AuthUser, @Param('entity') entity: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Extra)) b: z.infer<typeof Extra>) {
    return this.data.setExtra(u, new ZodPipe(ENTITY).transform(entity.toUpperCase()), id, b.values);
  }

  // ---------------- licences
  @Get('licences')
  licences() {
    return this.data.licenceAlerts();
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('licences/:type/:id')
  setLicence(@CurrentUser() u: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Licence)) b: z.infer<typeof Licence>) {
    return this.data.setLicence(u, new ZodPipe(z.enum(['shop', 'distributor'])).transform(type), id, b);
  }
}
