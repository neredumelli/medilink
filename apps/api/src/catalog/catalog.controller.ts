import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser, RETAILER_ROLES, requireRetailer, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogService } from './catalog.service';

const SearchQuery = z.object({ q: z.string().trim().min(1, 'Type at least one letter').max(60) });

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Search with live price, stock and best distributor for the signed-in shop. */
  @Roles(...RETAILER_ROLES)
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(SearchQuery)) query: z.infer<typeof SearchQuery>) {
    return this.catalog.search(requireRetailer(user), query.q);
  }

  @Roles(...RETAILER_ROLES)
  @Get('products/:id')
  product(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.card(requireRetailer(user), id);
  }

  /** Scan a strip or box barcode in the phone app. */
  @Roles(...RETAILER_ROLES)
  @Get('barcode/:code')
  barcode(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.catalog.byBarcode(requireRetailer(user), code.replace(/\D/g, '').slice(0, 20));
  }

  /** Names only, for offline search and list reading on the phone. */
  @Get('light')
  light() {
    return this.catalog.lightCatalog();
  }
}
