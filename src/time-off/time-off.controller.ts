import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { actorFromHeaders } from '../common/auth/header-actor';
import { RequestQueryService } from './application/request-query.service';
import { RequestsService } from './application/requests.service';
import { CancelTimeOffRequestDto } from './dto/cancel-time-off-request.dto';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ListTimeOffRequestsDto } from './dto/list-time-off-requests.dto';
import { ResolveTimeOffRequestDto } from './dto/resolve-time-off-request.dto';

@Controller('time-off/requests')
export class TimeOffController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly requestQueryService: RequestQueryService,
  ) {}

  @Post()
  createRequest(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Body() body: CreateTimeOffRequestDto,
  ) {
    return this.requestsService.createRequest(
      actorFromHeaders({ userId, role }),
      body,
    );
  }

  @Get(':id')
  getRequest(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Param('id') id: string,
  ) {
    return this.requestQueryService.getRequest(
      actorFromHeaders({ userId, role }),
      id,
    );
  }

  @Get()
  listRequests(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query() query: ListTimeOffRequestsDto,
  ) {
    return this.requestQueryService.listRequests(
      actorFromHeaders({ userId, role }),
      query,
    );
  }

  @Patch(':id/approve')
  approveRequest(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Param('id') id: string,
    @Body() body: ResolveTimeOffRequestDto,
  ) {
    return this.requestsService.approveRequest(
      actorFromHeaders({ userId, role }),
      id,
      body,
    );
  }

  @Patch(':id/reject')
  rejectRequest(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Param('id') id: string,
    @Body() body: ResolveTimeOffRequestDto,
  ) {
    return this.requestsService.rejectRequest(
      actorFromHeaders({ userId, role }),
      id,
      body,
    );
  }

  @Patch(':id/cancel')
  cancelRequest(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Param('id') id: string,
    @Body() body: CancelTimeOffRequestDto,
  ) {
    return this.requestsService.cancelRequest(
      actorFromHeaders({ userId, role }),
      id,
      body,
    );
  }
}
