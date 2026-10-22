import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser, RETAILER_ROLES, requireRetailer, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { ShopService } from './shop.service';

const qty = z.coerce.number().int().min(1, 'At least 1').max(9999);
const SetCart = z.object({ qty, distributorId: z.string().uuid().optional() });
const AddMany = z.object({ items: z.array(z.object({ productId: z.string().uuid(), qty })).min(1).max(200) });
const ReadList = z.object({ text: z.string().min(1).max(5000) });
const Shortage = z.object({ productId: z.string().uuid(), qty });
const Place = z.object({ timeToPlaceSec: z.number().int().min(0).max(86_400).optional(), source: z.enum(['APP', 'WEB', 'UPLOAD', 'WHATSAPP']).default('APP') });

@ApiTags('shop')
@ApiBearerAuth()
@Roles(...RETAILER_ROLES)
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('home')
  home(@CurrentUser() u: AuthUser) {
    return this.shop.home(requireRetailer(u));
  }

  // cart
  @Get('cart')
  cart(@CurrentUser() u: AuthUser) {
    return this.shop.getCart(requireRetailer(u));
  }

  @Put('cart/:productId')
  setCart(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) productId: string, @Body(new ZodPipe(SetCart)) b: z.infer<typeof SetCart>) {
    return this.shop.setCartItem(requireRetailer(u), productId, b.qty, b.distributorId);
  }

  @Post('cart/add-many')
  addMany(@CurrentUser() u: AuthUser, @Body(new ZodPipe(AddMany)) b: z.infer<typeof AddMany>) {
    return this.shop.addManyBest(requireRetailer(u), b.items);
  }

  @Delete('cart/:productId')
  removeCart(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.shop.removeCartItem(requireRetailer(u), productId);
  }

  // list reading ("Paste WhatsApp list")
  @Post('read-list')
  readList(@Body(new ZodPipe(ReadList)) b: z.infer<typeof ReadList>) {
    return this.shop.readList(b.text);
  }

  // shortage list (shared with staff)
  @Get('shortage')
  shortage(@CurrentUser() u: AuthUser) {
    return this.shop.shortageList(requireRetailer(u));
  }

  @Post('shortage')
  addShortage(@CurrentUser() u: AuthUser, @Body(new ZodPipe(Shortage)) b: z.infer<typeof Shortage>) {
    return this.shop.addShortage(u, requireRetailer(u), b.productId, b.qty);
  }

  @Delete('shortage/:id')
  removeShortage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.removeShortage(requireRetailer(u), id);
  }

  @Post('shortage/order-all')
  orderShortage(@CurrentUser() u: AuthUser) {
    return this.shop.orderShortageList(requireRetailer(u));
  }

  // orders
  @Post('orders')
  place(@CurrentUser() u: AuthUser, @Body(new ZodPipe(Place)) b: z.infer<typeof Place>) {
    return this.shop.placeOrders(u, requireRetailer(u), b);
  }

  @Get('orders')
  orders(@CurrentUser() u: AuthUser) {
    return this.shop.orders(requireRetailer(u));
  }

  @Post('orders/:id/reorder')
  reorder(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.reorder(requireRetailer(u), id);
  }

  @Post('orders/:id/get-rest')
  getRest(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.orderShortfall(requireRetailer(u), id);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.cancel(u, requireRetailer(u), id);
  }

  @Post('orders/:id/received')
  received(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.markReceived(u, requireRetailer(u), id);
  }

  // distributors
  @Get('distributors')
  distributors(@CurrentUser() u: AuthUser) {
    return this.shop.distributors(requireRetailer(u));
  }

  @Post('distributors/:id/link')
  link(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.requestLink(u, requireRetailer(u), id);
  }
}
