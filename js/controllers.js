define(['ajv'], function (Ajv) {

  var idRoot = 'https://raw.githubusercontent.com/qiicr/dcmqi/master/doc/';

  var schemasURL = idRoot + 'schemas/';
  var examplesURL = idRoot + 'examples/';

  var apiPrefix = 'https://api.github.com/repos/QIICR/dcmqi/contents/doc/';
  var apiSchemasRoot = apiPrefix + 'schemas';
  var apiExamplesRoot = apiPrefix + 'examples';

  function Schema (name, filename, examples) {
    this.name = name;
    this.id = schemasURL + filename;
    this.url = schemasURL + filename;
    this.examples = examples;
  }

  function Example (name, filename) {
    this.name = name;
    this.url = examplesURL + filename;
  }

  var anatomicRegionContextSources = [idRoot+'segContexts/AnatomicRegionAndModifier-DICOM-Master.json'];
  var segCategoryTypeContextSources = [idRoot+'segContexts/SegmentationCategoryTypeModifier-DICOM-Master.json',
                                       idRoot+'segContexts/SegmentationCategoryTypeModifier-SlicerGeneralAnatomy.json'];
  var pmContextSources = [idRoot+'pmContexts/pm-dce-context.json',
                          idRoot+'pmContexts/pm-dwi-context.json'];

  angular.module('app.controllers', [])
    .controller('MainController', MainController)
    .controller('JSONValidatorController', JSONValidatorController)
    .controller('MetaCreatorBaseController', MetaCreatorBaseController)
    .controller('SegmentationMetaCreatorController', SegmentationMetaCreatorController)
    .controller('ParametricMapMetaCreatorController', ParametricMapMetaCreatorController)
    .controller('CodeSequenceBaseController', CodeSequenceBaseController)
    .controller('ParametricMapQuantityCodeController', ParametricMapQuantityCodeController)
    .controller('ParametricMapMeasurementUnitsCodeController', ParametricMapMeasurementUnitsCodeController)
    .controller('AnatomicRegionController', AnatomicRegionController)
    .controller('AnatomicRegionModifierController', AnatomicRegionModifierController)
    .controller('SegmentedPropertyCategoryCodeController', SegmentedPropertyCategoryCodeController)
    .controller('SegmentedPropertyTypeController', SegmentedPropertyTypeController)
    .controller('SegmentedPropertyTypeModifierController', SegmentedPropertyTypeModifierController);


  function MainController($scope) {
    $scope.headlineText = "DCMQI Meta Information Generators";
    $scope.toolTipDelay = 500;
  }


  function JSONValidatorController($scope, ResourceLoaderService) {

    $scope.schemata = [];
    $scope.schema = undefined;

    ResourceLoaderService.loadResource(apiSchemasRoot, function(err, uri, body) {
      angular.forEach(body.data, function(value, key) {
        if(value.name.search("common") == -1) {
          $scope.schemata.push(new Schema(value.name.replace(".json", ""), value.name, []))
        }
      });
      ResourceLoaderService.loadResource(apiExamplesRoot, function(err1, uri1, body1) {
        angular.forEach(body1.data, function(example, key) {
          ResourceLoaderService.loadResource(examplesURL+example.name, function(err2, uri2, body2) {
            var schemaUrl = body2.data["@schema"].replace("#","");
            angular.forEach($scope.schemata, function(schema, key) {
              if(schemaUrl == schema.url) {
                schema.examples.push(new Example(example.name.replace(".json", ""), example.name));
              }
            });
          });
        });
      });
    });

    $scope.example = "";
    $scope.input = "";
    $scope.output = "";
    $scope.showExample = false;
    $scope.showSchema = false;
    $scope.exampleJson = "";
    $scope.schemaJson = "";

    var ajv = null;
    var schemaLoaded = false;
    var validate = undefined;
    var loadSchema = ResourceLoaderService.loadSchema;

    $scope.onSchemaSelected = function () {
      if($scope.schema == undefined)
        return;
      schemaLoaded = false;
      validate = undefined;
      $scope.output = "";

      ResourceLoaderService.loadSchemaWithReferences($scope.schema.url, onFinishedLoadingReferences);
    };

    $scope.onExampleSelected = function () {
      if ($scope.example == undefined)
        return;
      ResourceLoaderService.loadExample($scope.example.url, function(err, uri, body) {
        if (body != undefined) {
          $scope.exampleJson = JSON.stringify(body.data, null, 2);
        } else {
          $scope.exampleJson = "";
        }
      });
    };

    function onFinishedLoadingReferences(loadedURLs) {
      ajv = new Ajv({
        useDefaults: true,
        allErrors: true,
        loadSchema: loadSchema
      });

      angular.forEach(loadedURLs, function(value, key) {
        console.log("adding schema from url: " + value);
        var body = ResourceLoaderService.loadedReferences[value];
        ajv.addSchema(body.data);
      });

      schemaLoaded = true;
      validate = ajv.compile({$ref: $scope.schema.id});
      $scope.onOutputChanged();
      if($scope.schema && $scope.schema.examples.length > 0) {
        $scope.example = $scope.schema.examples[0];
        $scope.onExampleSelected();
      } else {
        $scope.example = undefined;
        $scope.exampleJson = "";
        $scope.showExample = false;
      }
      var body = ResourceLoaderService.loadedReferences[$scope.schema.url];
      $scope.schemaJson = JSON.stringify(body.data, null, 2);
    }

    $scope.onOutputChanged = function(e) {
      var message = "";
      if ($scope.input.length > 0) {
        try {
          var parsedJSON = JSON.parse($scope.input);
          if (!schemaLoaded) {
            $scope.output = "Schema for validation was not loaded.";
          } else {
            $scope.input = JSON.stringify(parsedJSON, null, 2);
            if (validate(parsedJSON)) {
              message = "Json input is valid.";
            } else {
              message = "";
              angular.forEach(validate.errors, function (value, key) {
                message += ajv.errorsText([value]) + "\n";
              });
            }
          }
        } catch(ex) {
          message = ex.message;
        }
      }
      $scope.output = message;
    };
  }

  function NotImplementedError(message) {
    this.name = "NotImplementedError";
    this.message = (message || "");
  }
  NotImplementedError.prototype = Error.prototype;


  function MetaCreatorBaseController(vm, $scope, $rootScope, $mdToast, $http, download, ResourceLoaderService) {

    $scope.init = function() {
      $scope.segment = {};
      vm.loadSchema = ResourceLoaderService.loadSchema;
      vm.ajv = new Ajv({
        useDefaults: true,
        allErrors: true,
        loadSchema: vm.loadSchema
      });

      vm.schemaLoaded = false;
      vm.validate = undefined;

      vm.initializeValidationSchema();
      vm.loadAnatomicRegionContexts();

      $scope.validJSON = false;
    };

    vm.initializeValidationSchema = function() {
      ResourceLoaderService.loadSchemaWithReferences(vm.schema.url, function(loadedURLs){
        angular.forEach(loadedURLs, function(value, key) {
          // console.log("adding schema from url: " + value);
          var body = ResourceLoaderService.loadedReferences[value];
          vm.ajv.addSchema(body.data);
        });
        vm.schemaLoaded = true;
        $scope.resetForm();
      });
    };

    vm.loadAnatomicRegionContexts = function() {
      $scope.anatomicRegionContexts = [];
      $scope.selectedAnatomicRegionContext = undefined;
      angular.forEach(anatomicRegionContextSources, function (value, key) {
        $http.get(value).success(function (data) {
          $scope.anatomicRegionContexts.push({
            url: value,
            name: data.AnatomicContextName
          });
          if (anatomicRegionContextSources.length == 1)
            $rootScope.selectedAnatomicRegionContext = $scope.anatomicRegionContexts[0];
        });
      });
    };

    $scope.submitForm = function(isValid) {
      if (isValid) {
        if (vm.createJSONOutput === undefined)
          throw new NotImplementedError("Method createJSONOutput needs to be implemented by all child classes!");
        else
          vm.createJSONOutput();
        vm.hideToast();
      } else {
        vm.showErrors();
      }
    };

    vm.showToast = function(content) {
      $mdToast.show(
        $mdToast.simple()
          .content(content)
          .action('OK')
          .position('bottom right')
          .hideDelay(100000)
      );
    };

    vm.hideToast = function() {
      $mdToast.hide();
    };

    vm.showErrors = function() {
      $scope.output = "";
      var firstError = $scope.jsonForm.$error.required[0];
      var elements = firstError.$name.split("_");
      var message = "[MISSING]: " + elements[0];
      if (elements[1] != undefined && elements[1] != "")
        message += " for segment with label id " + elements[1];
      vm.showToast(message);
    };

    $scope.onOutputChanged = function() {
      if ($scope.output.length > 0) {
        try {
          var parsedJSON = JSON.parse($scope.output);
          if (!vm.schemaLoaded) {
            vm.showToast("Schema for validation was not loaded.");
            return;
          }
          var valid = vm.validate(parsedJSON);
          $scope.output = JSON.stringify(parsedJSON, null, 2);
          if (valid) {
            vm.hideToast();
            $scope.validJSON = true;
          } else {
            $scope.validJSON = false;
            vm.showToast(vm.ajv.errorsText(vm.validate.errors));
          }
        } catch(ex) {
          $scope.validJSON = false;
          vm.showToast(ex.message);
        }
      }
    };

    $scope.downloadFile = function() {
      download.fromData($scope.output, "text/json", $scope.seriesAttributes.ClinicalTrialSeriesID+".json");
    };

    vm.getCodeSequenceAttributes = function(codeSequence) {
      if (codeSequence != null && codeSequence != undefined)
        return {"CodeValue":codeSequence.CodeValue,
                "CodingSchemeDesignator":codeSequence.CodingSchemeDesignator,
                "CodeMeaning":codeSequence.CodeMeaning}
    };

    $rootScope.$on("AnatomicRegionSelectionChanged", function(event, data) {
      $scope.segment.anatomicRegion = data.value;
    });

    $rootScope.$on("AnatomicRegionModifierSelectionChanged", function(event, data) {
      $scope.segment.anatomicRegionModifier = data.value;
    });

    $scope.init();
  }

  function SegmentationMetaCreatorController($scope, $rootScope, $controller, $http) {
    var vm = this;

    var init = function() {
      vm.schema = new Schema('Segmentation', 'seg-schema.json', []);
      vm.segmentedPropertyCategory = null;
      vm.segmentedPropertyType = null;
      vm.segmentedPropertyTypeModifier = null;
      vm.anatomicRegion = null;
      vm.anatomicRegionModifier = null;
      vm.currentLabelID = 1;
      $controller('MetaCreatorBaseController', {vm: vm, $scope: $scope, $rootScope: $rootScope});

      loadSegmentationContexts();
    };

    function loadDefaultSeriesAttributes() {
      var doc = {};
      if (vm.schemaLoaded) {
        vm.validate = vm.ajv.compile({$ref: vm.schema.id});
        var valid = vm.validate(doc);
        if (!valid) console.log(vm.ajv.errorsText(vm.validate.errors));
      }
      $scope.seriesAttributes = angular.extend({}, doc);
    }

    function loadAndValidateDefaultSegmentAttributes() {
      var doc = {
        "segmentAttributes": [[vm.getDefaultSegmentAttributes()]]
      };
      if (vm.schemaLoaded) {
        vm.validate = vm.ajv.compile({$ref: vm.schema.id});
        var valid = vm.validate(doc);
        if (!valid) console.log(vm.ajv.errorsText(vm.validate.errors));
      }
      return doc.segmentAttributes[0][0];
    }

    $scope.resetForm = function() {
      $scope.validJSON = false;
      vm.currentLabelID = 1;
      loadDefaultSeriesAttributes();
      $scope.segments = [loadAndValidateDefaultSegmentAttributes()];
      $scope.segments[0].recommendedDisplayRGBValue = angular.extend({}, defaultRecommendedDisplayValue);
      $scope.segment = $scope.segments[0];
      $scope.output = "";
    };

    var colorPickerDefaultOptions = {
      clickOutsideToClose: true,
      openOnInput: false,
      mdColorAlphaChannel: false,
      mdColorClearButton: false,
      mdColorSliders: false,
      mdColorHistory: false,
      mdColorGenericPalette: false,
      mdColorMaterialPalette:false,
      mdColorHex: false,
      mdColorHsl: false
    };

    var defaultRecommendedDisplayValue = {
      color: '',
      backgroundOptions: angular.extend({}, colorPickerDefaultOptions)
    };

    // TODO: populate that from schema?
    $scope.segmentAlgorithmTypes = [
      "MANUAL",
      "SEMIAUTOMATIC",
      "AUTOMATIC"
    ];

    $scope.isSegmentAlgorithmNameRequired = function(algorithmType) {
      return ["SEMIAUTOMATIC", "AUTOMATIC"].indexOf(algorithmType) > -1;
    };

    vm.getDefaultSegmentAttributes = function() {
      return {
        labelID: vm.currentLabelID,
        SegmentDescription: "",
        AnatomicRegionSequence: {},
        AnatomicRegionModifierSequence: {},
        SegmentedPropertyTypeModifierCodeSequence: {}
      };
    };

    function loadSegmentationContexts() {
      $scope.segmentationContexts = [];
      $rootScope.selectedSegmentationCategoryContext = undefined;
      angular.forEach(segCategoryTypeContextSources, function (value, key) {
        $http.get(value).success(function (data) {
          $scope.segmentationContexts.push({
            url: value,
            name: data.SegmentationCategoryTypeContextName
          });
        });
        if ($scope.segmentationContexts.length == 1)
          $rootScope.selectedSegmentationCategoryContext = $scope.segmentationContexts[0];
      });
    }

    $scope.addSegment = function() {
      vm.currentLabelID += 1;
      var segment = loadAndValidateDefaultSegmentAttributes();
      segment.recommendedDisplayRGBValue = angular.extend({}, defaultRecommendedDisplayValue);
      $scope.segments.push(segment);
      $scope.selectedIndex = $scope.segments.length-1;
    };

    $scope.removeSegment = function() {
      $scope.segments.splice($scope.selectedIndex, 1);
      if ($scope.selectedIndex-1 < 0)
        $scope.selectedIndex = 0;
      else
        $scope.selectedIndex -= 1;
      $scope.output = "";
    };

    $scope.previousSegment = function() {
      $scope.selectedIndex -= 1;
    };

    $scope.nextSegment = function() {
      $scope.selectedIndex += 1;
    };

    $scope.$watch('selectedIndex', function () {
      if($scope.segments != undefined) {
        $scope.segment = $scope.segments[$scope.selectedIndex];
      }
    });

    $scope.segmentAlreadyExists = function(segment) {
      var exists = false;
      angular.forEach($scope.segments, function(value, key) {
        if(value.labelID == segment.labelID && value != segment) {
          exists = true;
        }
      });
      return exists;
    };

    vm.createJSONOutput = function() {

      var doc = {
        "ContentCreatorName": $scope.seriesAttributes.ContentCreatorName,
        "ClinicalTrialSeriesID" : $scope.seriesAttributes.ClinicalTrialSeriesID,
        "ClinicalTrialTimePointID" : $scope.seriesAttributes.ClinicalTrialTimePointID,
        "SeriesDescription" : $scope.seriesAttributes.SeriesDescription,
        "SeriesNumber" : $scope.seriesAttributes.SeriesNumber,
        "InstanceNumber" : $scope.seriesAttributes.InstanceNumber
      };

      if ($scope.seriesAttributes.BodyPartExamined.length > 0)
        doc["BodyPartExamined"] = $scope.seriesAttributes.BodyPartExamined;

      var segmentAttributes = [];
      angular.forEach($scope.segments, function(value, key) {
        var attributes = {};
        attributes["labelID"] = value.labelID;
        if (value.SegmentDescription.length > 0)
          attributes["SegmentDescription"] = value.SegmentDescription;
        if (value.SegmentAlgorithmType.length > 0)
          attributes["SegmentAlgorithmType"] = value.SegmentAlgorithmType;
        if (value.SegmentAlgorithmName != undefined && value.SegmentAlgorithmName.length > 0)
          attributes["SegmentAlgorithmName"] = value.SegmentAlgorithmName;
        if (value.anatomicRegion)
          attributes["AnatomicRegionSequence"] = vm.getCodeSequenceAttributes(value.anatomicRegion);
        if (value.anatomicRegionModifier)
          attributes["AnatomicRegionModifierSequence"] = vm.getCodeSequenceAttributes(value.anatomicRegionModifier);
        if (value.segmentedPropertyCategory)
          attributes["SegmentedPropertyCategoryCodeSequence"] = vm.getCodeSequenceAttributes(value.segmentedPropertyCategory);
        if (value.segmentedPropertyType)
          attributes["SegmentedPropertyTypeCodeSequence"] = vm.getCodeSequenceAttributes(value.segmentedPropertyType);
        if (value.segmentedPropertyTypeModifier)
          attributes["SegmentedPropertyTypeModifierCodeSequence"] = vm.getCodeSequenceAttributes(value.segmentedPropertyTypeModifier);
        if (value.recommendedDisplayRGBValue.color)
          attributes["recommendedDisplayRGBValue"] = vm.rgbToArray(value.recommendedDisplayRGBValue.color);
        segmentAttributes.push(attributes);
      });

      doc["segmentAttributes"] = [segmentAttributes];

      $scope.output = JSON.stringify(doc, null, 2);
      $scope.onOutputChanged();
    };

    vm.rgbToArray = function(str) {
      var rgb = str.replace("rgb(", "").replace(")", "").split(", ");
      return [parseInt(rgb[0]), parseInt(rgb[1]), parseInt(rgb[2])];
    };

    $rootScope.$on("SegmentedPropertyCategorySelectionChanged", function(event, data) {
      $scope.segment.segmentedPropertyCategory = data.value;
    });

    $rootScope.$on("SegmentedPropertyTypeSelectionChanged", function(event, data) {
      $scope.segment.segmentedPropertyType = data.segmentedPropertyType;
      $scope.segment.recommendedDisplayRGBValue.color = data.color;
      $scope.segment.hasRecommendedColor = data.hasRecommendedColor;
    });

    $rootScope.$on("SegmentedPropertyTypeModifierSelectionChanged", function(event, data) {
      $scope.segment.segmentedPropertyTypeModifier = data.value;
    });

    init();
  }


  function ParametricMapMetaCreatorController($scope, $rootScope, $controller, $http) {
    var vm = this;

    var init = function() {
      vm.schema = new Schema('Parametric Map', 'pm-schema.json', []);
      $controller('MetaCreatorBaseController', {vm: vm, $scope: $scope, $rootScope: $rootScope});

      loadParametricMapContexts();
    };

    $scope.resetForm = function() {
      $scope.segment = {};
      $scope.validJSON = false;
      loadDefaultSeriesAttributes();
      $scope.output = "";
    };

    $scope.$watch('selectedAnatomicRegionContext', function () {
      $scope.segment = {};
    });

    $scope.$watch('selectedParametricMapContext', function () {
      $scope.segment = {};
    });

    function loadDefaultSeriesAttributes() {
      var doc = {};
      if (vm.schemaLoaded) {
        vm.validate = vm.ajv.compile({$ref: vm.schema.id});
        var valid = vm.validate(doc);
        if (!valid) console.log(vm.ajv.errorsText(vm.validate.errors));
      }
      $scope.seriesAttributes = angular.extend({}, doc);
    }

    function loadParametricMapContexts() {
      $scope.pmapContexts = [];
      $rootScope.selectedParametricMapContext = undefined;
      angular.forEach(pmContextSources, function (value, key) {
        $http.get(value).success(function (data) {
          $scope.pmapContexts.push({
            url: value,
            name: data.name
          });
        });
        if ($scope.pmapContexts.length == 1)
          $rootScope.selectedParametricMapContext = $scope.pmapContexts[0];
      });
    }

    vm.createJSONOutput = function() {

      var doc = {
        "SeriesDescription" : $scope.seriesAttributes.SeriesDescription,
        "SeriesNumber" : $scope.seriesAttributes.SeriesNumber,
        "InstanceNumber" : $scope.seriesAttributes.InstanceNumber
      };

      if ($scope.seriesAttributes.BodyPartExamined.length > 0)
        doc["BodyPartExamined"] = $scope.seriesAttributes.BodyPartExamined;

      if ($scope.segment.anatomicRegion)
        doc["AnatomicRegionSequence"] = vm.getCodeSequenceAttributes($scope.segment.anatomicRegion);
      if ($scope.segment.anatomicRegionModifier)
        doc["AnatomicRegionModifierSequence"] = vm.getCodeSequenceAttributes($scope.segment.anatomicRegionModifier);

      if ($scope.segment.quantity) {
        doc["QuantityValueCode"] = vm.getCodeSequenceAttributes($scope.segment.quantity);
        doc["MeasurementUnitsCode"] = vm.getCodeSequenceAttributes($scope.segment.unit);
      }
      $scope.output = JSON.stringify(doc, null, 2);
      $scope.onOutputChanged();
    };

    $rootScope.$on("QuantityCodeSelectionChanged", function(event, data) {
      $scope.segment.quantity = data.value;
    });

    $rootScope.$on("MeasurementUnitSelectionChanged", function(event, data) {
      $scope.segment.unit = data.value;
    });

    init();
  }


  function CodeSequenceBaseController($self, $scope, $rootScope, $timeout, $q) {
    var self = $self;

    $scope.ctrl = self;
    self.simulateQuery = false;
    self.required = $scope.required;
    self.segmentNumber = $scope.segmentNumber;

    self.querySearch   = querySearch;
    self.selectedItemChange = selectedItemChange;
    self.selectionChangedEvent = "";

    self.reset = function(){
      self.mappedCodes = [];
      self.searchText = undefined;
      $scope.isDisabled = true;
    };

    self.selectedItemChange = function(item) {
      if (self.selectedItem === null) {
        self.searchText = "";
      }
      $rootScope.$emit(self.selectionChangedEvent, {
        segmentNumber: $scope.segmentNumber,
        item:self.selectedItem,
        value:item ? item.object : item});
    };

    function querySearch (query) {
      var results = query ? self.mappedCodes.filter( createFilterFor(query) ) : self.mappedCodes,
        deferred;
      if (self.simulateQuery) {
        deferred = $q.defer();
        $timeout(function () { deferred.resolve( results ); }, Math.random() * 1000, false);
        return deferred.promise;
      } else {
        return results;
      }
    }

    function selectedItemChange(item) {
      if (self.selectedItem === null) {
        self.searchText = "";
      }
      $rootScope.$emit(self.selectionChangedEvent, {item:item, segment:$scope.segment});
    }

    function createFilterFor(query) {
      var lowercaseQuery = angular.lowercase(query);
      return function filterFn(item) {
        return (item.value.indexOf(lowercaseQuery) != -1);
      };
    }

    self.codesList2CodeMeaning = function(list) {
      if(Object.prototype.toString.call( list ) != '[object Array]' ) {
        list = [list];
      }
      list.sort(function(a,b) {return (a.CodeMeaning > b.CodeMeaning) ? 1 : ((b.CodeMeaning > a.CodeMeaning) ? -1 : 0);});
      return list.map(function (code) {
        return {
          value: self.getValueInformation(code),
          additionalInformation : self.getAdditionalInformation(code),
          display: self.getDisplayInformation(code),
          object: code
        }
      })
    };

    self.setMappedCodes = function(data, key){
      if (data.segmentNumber != $scope.segmentNumber)
        return;
      if (data.value) {
        $scope.isDisabled = data.value[key] === undefined;
        if (data.value[key] === undefined) {
          self.searchText = undefined;
          self.mappedCodes = [];
        } else {
          self.mappedCodes = self.codesList2CodeMeaning(data.value[key]);
        }
        if(self.mappedCodes.length == 1)
          self.selectedItem = self.mappedCodes[0];
      } else {
        self.reset();
      }
    };

    self.getAdditionalInformation = function(code) {
      return code.contextGroupName;
    };

    self.getDisplayInformation = function(code) {
      return code.CodeMeaning;
    };

    self.getValueInformation = function(code) {
      return code.CodeMeaning.toLowerCase();
    };
  }


  function ParametricMapQuantityCodeController($scope, $rootScope, $http, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Quantity Code";
    self.selectionChangedEvent = "QuantityCodeSelectionChanged";

    $rootScope.$watch('selectedParametricMapContext', function () {
      if ($rootScope.selectedParametricMapContext != undefined) {
        $http.get($rootScope.selectedParametricMapContext.url).success(function (data) {
          $scope.quantityDefinitions = data.QuantityDefinitions;
          self.mappedCodes = self.codesList2CodeMeaning($scope.quantityDefinitions);
        });
      }
    });

    self.getAdditionalInformation = function(code) {
      var units = [];
      angular.forEach(code.MeasurementUnitsCode, function(code, key) {
        units.push(code.CodeMeaning);
      });
      return "available units: " + units.toString();
    };
  }


  function ParametricMapMeasurementUnitsCodeController($scope, $rootScope, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Measurement Unit";
    $scope.isDisabled = true;
    self.selectionChangedEvent = "MeasurementUnitSelectionChanged";

    $rootScope.$on("QuantityCodeSelectionChanged", function(event, data) {
      self.setMappedCodes(data, "MeasurementUnitsCode");
    });
  }


  function AnatomicRegionController($scope, $rootScope, $http, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Anatomic Region";
    self.selectionChangedEvent = "AnatomicRegionSelectionChanged";

    $rootScope.$on("SegmentedPropertyCategorySelectionChanged", function(event, data) {
      if (data.segmentNumber != $scope.segmentNumber)
        return;
      if (data.value) {
        $scope.isDisabled = !data.value.showAnatomy;
        self.searchText = !data.value.showAnatomy ? undefined : self.searchText;
      } else {
        $scope.isDisabled = false;
      }
    });

    $rootScope.$watch('selectedAnatomicRegionContext', function () {
      if ($rootScope.selectedAnatomicRegionContext != undefined) {
        $http.get($rootScope.selectedAnatomicRegionContext.url).success(function (data) {
          $scope.anatomicCodes = data.AnatomicCodes.AnatomicRegion;
          self.mappedCodes = self.codesList2CodeMeaning($scope.anatomicCodes);
        });
      }
    });
  }


  function AnatomicRegionModifierController($scope, $rootScope, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Anatomic Region Modifier";
    $scope.isDisabled = true;
    self.selectionChangedEvent = "AnatomicRegionModifierSelectionChanged";

    $rootScope.$on("AnatomicRegionSelectionChanged", function(event, data) {
      self.setMappedCodes(data, "Modifier");
    });
  }


  function SegmentedPropertyCategoryCodeController($scope, $rootScope, $http, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Segmented Category";
    self.selectionChangedEvent = "SegmentedPropertyCategorySelectionChanged";

    $rootScope.$watch('selectedSegmentationCategoryContext', function () {
      if ($rootScope.selectedSegmentationCategoryContext != undefined) {
        $http.get($rootScope.selectedSegmentationCategoryContext.url).success(function (data) {
          $scope.segmentationCodes = data.SegmentationCodes.Category;
          self.mappedCodes = self.codesList2CodeMeaning($scope.segmentationCodes);
        });
      }
    });
  }


  function SegmentedPropertyTypeController($scope, $rootScope, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Segmented Property Type";
    $scope.isDisabled = true;
    self.selectionChangedEvent = "SegmentedPropertyTypeSelectionChanged";

    self.selectedItemChange = function(item) {
      if (self.selectedItem === null) {
        var color = "";
        var hasRecommendedColor = false;
        self.searchText = "";
      } else if (self.selectedItem.object.recommendedDisplayRGBValue != undefined) {
        hasRecommendedColor = true;
        var rgb = self.selectedItem.object.recommendedDisplayRGBValue;
        color = 'rgb('+rgb[0]+', '+rgb[1]+', '+rgb[2]+')';
      }
      $rootScope.$emit(self.selectionChangedEvent, {
        item:self.selectedItem,
        value:item ? item.object : item,
        segmentedPropertyType:item ? item.object : item,
        hasRecommendedColor:hasRecommendedColor,
        color:color
      });
    };

    $rootScope.$on("SegmentedPropertyCategorySelectionChanged", function(event, data) {
      self.setMappedCodes(data, "Type");
    });
  }


  function SegmentedPropertyTypeModifierController($scope, $rootScope, $controller) {
    $controller('CodeSequenceBaseController', {$self:this, $scope: $scope, $rootScope: $rootScope});
    var self = this;
    self.floatingLabel = "Segmented Property Type Modifier";
    $scope.isDisabled = true;
    self.selectionChangedEvent = "SegmentedPropertyTypeModifierSelectionChanged";

    $rootScope.$on("SegmentedPropertyTypeSelectionChanged", function(event, data) {
      self.setMappedCodes(data, "Modifier");
    });
  }

});