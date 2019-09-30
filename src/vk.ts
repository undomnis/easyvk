import { IVKOptions, ExceptionHandler, ComposerName } from './types';
import API from './structures/api/api';
import Plugin from './structures/plugin/plugin';
import Auth from './plugins/auth';
import Storage from './plugins/storage';
import {Composer, Middleware, NextMiddleware, noopNext} from 'middleware-io';

class VK {
  [x: string]: any;

  /** Default options */
  public options: IVKOptions = {
    mode: 'default',
    defaults: {
      v: '5.101',
      lang: 'ru'
    },
    api: {
      domain: 'vk.com',
      protocol: 'https',
      apiSubdomain: 'api',
      oauthSubdomain: 'oauth',
      methodPath: 'method/'
    },
    auth: {
      groupsMethod: 'groups.getById',
      usersMethod: 'users.get',
      appsMethod: 'apps.get',
      passwordGrantType: 'password',
      deviceId: ''
    },
    errors: {
      captchaError: 'need_captcha',
      captchaErrorCode: 14,
      validationError: 'need_validation',
      redirectErrorCode: 17
    }
  };

  /** Default options which will be used in each API qeury */
  public defaultsOptions = this.options.defaults;

  /** Queue of installing plugins */
  public pluginsQueue = [];
  /** Queue of installating plugins names */
  public pluginsQueueNames = [];
  public plugins = [];
  /** Promises which already used in installation or not really */
  public queuePromises = [];
  
  public handlers = new WeakMap<any, ExceptionHandler[]>();
  public handlersExceptions = new Set<any>();

  /** API object for make API queries */
  public api = new API(this);
  
  /** Map of composers by name */
  public composersStack = new Map<ComposerName, Composer<any>>()

  constructor(options: IVKOptions) {
    this.setOptions(options);
    this.defaults(this.options.defaults);
    this.installDefaultsPlugins();
  }

  private installDefaultsPlugins () {
    this.extend(Storage);
    this.extend(Auth);
  }

  /**
   * Makes separate new VK options with old VK options
   * @param options New VK options
   */
  public setOptions(options: IVKOptions):this {
    this.options = {
      ...this.options,
      ...options
    }

    return this;
  }

  /**
   * Makes separete new options with old default options
   * @param options New default options for API queries
   */
  public defaults(options: { [key: string]: any }):this {

    this.defaultsOptions = {
      ...this.defaultsOptions,
      ...options
    }

    return this;
  }


  /**
   * Installs new plugin in main VK class library
   * Plugins are help for programmer create new features and extend the main library class
   * Also they can help support of newest updates for VK if this library will stop updating
   * 
   * @param plugin Plugin object which you want to install
   * @param pluginOptions Object options for this plugin
   * @param addInQueue If you want install plugin with others in one query, use it
   */
  public async extend(plugin: typeof Plugin, pluginOptions: { [key: string]: any } = {}, addInQueue: boolean = true) {
    let plugIn = new plugin(this, pluginOptions);

    if (!plugIn.name || plugIn.name === 'defaultPlugin') throw new Error('Plugin must have unique name');
    if (this.hasPlugin(plugIn.name)) throw new Error('This plugin already installed');

    const newPlugin = {
      plugin: plugIn,
      options: pluginOptions,
      name: plugIn.name
    }

    if (plugIn.requirements) {
      for (let requiredPluginName of plugIn.requirements) {
        if (this.hasPlugin(requiredPluginName)) continue;
        if (this.pluginsQueueNames.indexOf(requiredPluginName) !== -1) continue;
        throw new Error(`Plugin requires a ${requiredPluginName} plugin. You should install this plugin!`);
      }
    }

    if (plugIn.setupAfter && addInQueue) {
      let setupAfterIndex = this.pluginsQueue.indexOf(plugIn.setupAfter);
      if (setupAfterIndex !== -1) {
        this.pluginsQueue.splice(setupAfterIndex, 0, newPlugin);
        this.pluginsQueueNames.splice(setupAfterIndex, 0, newPlugin);
      }
    }

    if (!plugIn.setupAfter && addInQueue) {
      this.pluginsQueue.push(newPlugin);
      this.pluginsQueueNames.push(newPlugin.name);
    }

    if (!this.pluginInQueue(newPlugin.plugin) && addInQueue) {
      this.pluginsQueue.push(newPlugin);
      this.pluginsQueueNames.push(newPlugin.name);
    } else if (!addInQueue) {
      this.plugins.push(plugIn.name)
      const enable = plugIn.onEnable(pluginOptions);
      this.queuePromises.push(enable);
      return enable;
    }
  }

  /**
   * Checks that this plugin waiting for installation
   * @param plugin Plugin object
   */
  public pluginInQueue(plugin: Plugin): boolean {
    return this.pluginsQueueNames.indexOf(plugin.name) !== -1;
  }

  /**
   * Checks that this plugin installed in VK class library
   * @param pluginName Plugin name
   */
  public hasPlugin(pluginName: string): boolean {
    return this.plugins.indexOf(pluginName) !== -1;
  }

  /**
   * Setting up all plugins and intializes them
   */
  public async setup(globalPluginOptions: {[key: string]: any}): Promise<this> {
    if (!this.pluginsQueue.length) return this;

    let initers = [...this.pluginsQueue];

    initers.forEach(({ plugin, options }, i) => {
      this.plugins.push(plugin.name);
      initers[i] = plugin.onEnable({
        ...options,
        ...(globalPluginOptions[plugin.name] || {})
      });
    });

    return Promise.all([...initers, ...this.queuePromises]).then(() => this);
  }

  /**
   * Updates property value (if your plugin wants to add a link fro yourself in main VK object)
   * @param propName property value which you want to update
   * @param value value which you want to set
   */
  public link(propName: string, value: any):this {

    if (this.linked(propName)) throw new Error(`This property already exists! (${propName}, ${this[propName]})`);

    return this.redefine(propName, {
      configurable: false,
      value
    });
  }

  /**
   * Checks that this property already linked
   * @param propName Property name which you want check on link
   */
  public linked (propName: string):boolean {
    return this.hasOwnProperty(propName);
  }

  /**
   * Allow redefine VK main class properties and methods
   * @param propName property name (or method name)
   * @param props descriptor config
   */
  public redefine (propName: string, props:PropertyDescriptor):this {
    Object.defineProperty(this, propName, props);
    return this;
  }

  /**
   * Makes handle this exception type by this handler
   * For example: APIException == HaveBanException == Error. So, if you want to handle all errors or just certain, you can do it
   * @param exceptionType Exception constructor (class), for example: CaptchaException from ./errors
   * @param handler handler function
   */
  public handleException (exceptionType:Error, handler:ExceptionHandler):[Error, number] {
    this.handlersExceptions.add(exceptionType);
    let exceptionHandlers = [...this.exceptionHandlers(exceptionType), handler];
    this.handlers.set(exceptionType, exceptionHandlers);
    return [exceptionType, exceptionHandlers.length - 1];
  }
  
  /**
   * Makes handle this exception type by this handler and push this handler to begin of handlers queue
   * For example: APIException == HaveBanException == Error. So, if you want to handle all errors or just certain, you can do it
   * @param exceptionType Exception constructor (class), for example: CaptchaException from ./errors
   * @param handler handler function
   */
  public handleExceptionFirstly (exceptionType:Error, handler:ExceptionHandler):[Error, number] {
    this.handlersExceptions.add(exceptionType);
    let exceptionHandlers = [handler, ...this.exceptionHandlers(exceptionType)];
    this.handlers.set(exceptionType, exceptionHandlers);
    return [exceptionType, 0];
  }

  /**
   * Removes exception handler by its position
   * @param exceptionPosition Is array which you got wfrom methods like handleException()
   */
  public removeExceptionHandler(exceptionPosition:[Error, number]):void {
    let exceptions = this.exceptionHandlers(exceptionPosition[0]);
    exceptions = exceptions.filter((_, i) => i !== exceptionPosition[1]);
    this.handlers.set(exceptionPosition[0], exceptions);
  }

  /**
   * Returns all handlers of this exception type
   * @param exceptionType Exception constructor (class), for example: CaptchaException from ./errors
   */
  public exceptionHandlers (exceptionType:Error):ExceptionHandler[] {
    return this.handlers.get(exceptionType) || [];
  }
  
  /**
   * This method processes error by error handlers. If handler returned this error then error will be throw
   * else response will be ignored and handler will make something with this error
   * For example: APIException == HaveBanException == Error. So, if you want to handle all errors or just certain, you can do it
   * @param exceptionType exception constructor (class) name
   * @param error Error object which will be sent to handler
   */
  public async processHandlers (exceptionType:any, error:Error):Promise<Error|boolean> {
    return new Promise(async (resolve, reject) => {
      let handled = false;
      for (let exceptionTypeHandled of this.handlersExceptions) {
        if (exceptionTypeHandled.isPrototypeOf(exceptionType) || exceptionTypeHandled === exceptionType) {
          let handlers = this.exceptionHandlers(exceptionTypeHandled);

          for (let handler of handlers) {
            let handlerReturned = await handler(error, exceptionType);
            if (handlerReturned !== error) {
              handled = true;
              if (handlerReturned) resolve(handlerReturned);
              break;
            }
          }
        }
      }
      if (!handled) reject(error);
    })
  }

  /**
   * Checks that this composer type already registered
   * @param composerName Composer identifier (middleware type)
   */
  public hasComposer (composerName: ComposerName):boolean {
    return this.getComposer(composerName) !== undefined;
  }

  /**
   * Returns a composer of a middlewaretype
   * @param composerName 
   */
  public getComposer(composerName: ComposerName):Composer {
    return this.composersStack.get(composerName);
  }

  /**
   * Adds new composer to composers
   * @param composerName a type of middlewares
   * @param stack array of functionshandlers (Middlewares)
   */
  public addComposer (composerName: ComposerName, stack:Middleware<any>[]):this {
    let composer:Composer<any>;

    // Adds only if not have
    if (!this.hasComposer(composerName)) {
      composer = new Composer<any>();
      
      for (let middleware of stack) {
        composer.use(middleware);
      }

      this.composersStack.set(composerName, composer);
    }

    return this;
  }

  /**
   * Adds new middleware to composer
   * @param composerName middleware type
   * @param middleware middleware handler
   */
  public use (composerName: ComposerName, middleware:Middleware<any>):this {

    if (this.hasComposer(composerName)) {
      let composer = this.getComposer(composerName);
      composer.use(middleware);
      this.composersStack.set(composerName, composer);
    } else {
      this.addComposer(composerName, [middleware]);
    }
    
    return this;
  }

  /**
   * Runs a middleware
   * @param composerName middleware type 
   * @param context context object
   */
  public compose (composerName, context:any):Middleware<any> {
    
    if (!this.hasComposer(composerName)) {
      throw new Error('You trying run composer which not created!');
    }

    return this.getComposer(composerName).compose()(context, noopNext);
  }
}

export default VK;