/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as common from '@google-cloud/common';
import delay from 'delay';
import * as r from 'request';  // types only
import {teenyRequest} from 'teeny-request';

const packageJson = require('../../package.json');

export interface ServiceContext {
  service: string;
  version: string;
  resourceType: string;
}

export interface ErrorEvent {
  eventTime: string;
  serviceContext: ServiceContext;
  message: string;
  // other fields not used in the tests have been omitted
}

export interface ErrorGroupStats {
  group: {groupId: string};
  representative: ErrorEvent;
  count: string;
  // other fields not used in the tests have been omitted
}

/* @const {String} Base Error Reporting API */
const API = 'https://clouderrorreporting.googleapis.com/v1beta1/projects';

const ONE_HOUR_API = 'timeRange.period=PERIOD_1_HOUR';

export class ErrorsApiTransport extends common.Service {
  constructor() {
    super({
      requestModule: teenyRequest as typeof r,
      baseUrl: 'https://clouderrorreporting.googleapis.com/v1beta1',
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      packageJson
    });
  }

  async deleteAllEvents(): Promise<void> {
    const projectId = await this.getProjectId();
    const options = {
      uri: [API, projectId, 'events'].join('/'),
      method: 'DELETE'
    };
    await this.request(options);
  }

  async getAllGroups(): Promise<ErrorGroupStats[]> {
    const projectId = await this.getProjectId();
    const options = {
      uri: [API, projectId, 'groupStats?' + ONE_HOUR_API].join('/'),
      method: 'GET'
    };
    const response = await this.request(options);
    return response.body.errorGroupStats || [];
  }

  async getGroupEvents(groupId: string): Promise<ErrorEvent[]> {
    const projectId = await this.getProjectId();
    const options = {
      uri: [
        API, projectId,
        'events?groupId=' + groupId + '&pageSize=10&' + ONE_HOUR_API
      ].join('/'),
      method: 'GET'
    };

    const response = await this.request(options);
    return response.body.errorEvents || [];
  }

  async pollForNewEvents(service: string, time: number, timeout: number):
      Promise<ErrorEvent[]> {
    const timeLimit = Date.now() + timeout;
    let groupId;
    const filteredEvents: ErrorEvent[] = [];
    // wait for a group
    while (Date.now() < timeLimit) {
      await delay(1000);

      if (!groupId) {
        const groups = await this.getAllGroups();
        if (!groups.length) continue;
        // find an error group that matches the service
        groups.forEach((group) => {
          try {
            // example value: logging-winston-system-test
            if (group.representative.serviceContext.service === service) {
              groupId = group.group.groupId;
            }
          } catch (e) {
            // keep looking
          }
        });
      }

      // didnt find an error reporting group matching the service.
      if (!groupId) continue;

      const events = await this.getGroupEvents(groupId);
      events.forEach((event) => {
        if (new Date(event.eventTime).getTime() >= time) {
          filteredEvents.push(event);
        }
      });
      if (filteredEvents.length) break;
    }
    return filteredEvents;
  }
}
