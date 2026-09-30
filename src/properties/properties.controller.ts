import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReorderMediaDto } from '../media/dto/reorder-media.dto';
import type { UploadedMediaFile } from '../media/media.service';
import { UploadMedia } from '../media/upload-media.decorator';
import { CurrentUser } from '../users/current-user.decorator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ReplaceSharedAreasDto } from './dto/replace-shared-areas.dto';
import { UpdatePropertyStatusDto } from './dto/update-property-status.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertiesService } from './properties.service';

type User = AuthenticatedRequest['user'];

@Controller('owner/properties')
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.propertiesService.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user.id, dto);
  }

  @Get(':propertyId')
  get(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.propertiesService.get(user.id, propertyId);
  }

  @Patch(':propertyId')
  update(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(user.id, propertyId, dto);
  }

  @Patch(':propertyId/status')
  updateStatus(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdatePropertyStatusDto,
  ) {
    return this.propertiesService.updateStatus(user.id, propertyId, dto.status);
  }

  @Delete(':propertyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.propertiesService.remove(user.id, propertyId);
  }

  @Put(':propertyId/shared-areas')
  replaceSharedAreas(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ReplaceSharedAreasDto,
  ) {
    return this.propertiesService.replaceSharedAreas(user.id, propertyId, dto);
  }

  @Post(':propertyId/media')
  @UploadMedia()
  addMedia(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @UploadedFile() file: UploadedMediaFile | undefined,
  ) {
    return this.propertiesService.addMedia(user.id, propertyId, file);
  }

  @Put(':propertyId/media/order')
  reorderMedia(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.propertiesService.reorderMedia(user.id, propertyId, dto);
  }

  @Delete(':propertyId/media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMedia(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.propertiesService.removeMedia(user.id, propertyId, mediaId);
  }
}
