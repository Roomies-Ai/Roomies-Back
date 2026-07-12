import { Test, TestingModule } from '@nestjs/testing';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let appService: { getHello: jest.Mock<() => string> };

  beforeEach(async () => {
    appService = { getHello: jest.fn<() => string>().mockReturnValue('Hello World!') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();

    controller = module.get(AppController);
  });

  it('GET / returns the AppService greeting', () => {
    expect(controller.getHello()).toBe('Hello World!');
    expect(appService.getHello).toHaveBeenCalled();
  });
});