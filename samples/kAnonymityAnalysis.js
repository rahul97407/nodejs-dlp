// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// sample-metadata:
//  title: kAnonymity Analysis
//  description: Computes the k-anonymity of a column set in a Google BigQuery table
//  usage: node kAnonymityAnalysis.js my-project tableProjectId datasetId tableId topicId subscriptionId quasiIds

function main(
  projectId,
  tableProjectId,
  datasetId,
  tableId,
  topicId,
  subscriptionId,
  quasiIds
) {
  quasiIds = transformCLI(quasiIds);

  console.log(tableId);
  console.log(topicId);
  console.log(subscriptionId);
  console.log(quasiIds);
  // [START dlp_k_anonymity]
  // Import the Google Cloud client libraries
  const DLP = require('@google-cloud/dlp');
  const {PubSub} = require('@google-cloud/pubsub');

  // Instantiates clients
  const dlp = new DLP.DlpServiceClient();
  const pubsub = new PubSub();

  // The project ID to run the API call under
  // const projectId = 'my-project';

  // The project ID the table is stored under
  // This may or (for public datasets) may not equal the calling project ID
  // const tableProjectId = 'my-project';

  // The ID of the dataset to inspect, e.g. 'my_dataset'
  // const datasetId = 'my_dataset';

  // The ID of the table to inspect, e.g. 'my_table'
  // const tableId = 'my_table';

  // The name of the Pub/Sub topic to notify once the job completes
  // TODO(developer): create a Pub/Sub topic to use for this
  // const topicId = 'MY-PUBSUB-TOPIC'

  // The name of the Pub/Sub subscription to use when listening for job
  // completion notifications
  // TODO(developer): create a Pub/Sub subscription to use for this
  // const subscriptionId = 'MY-PUBSUB-SUBSCRIPTION'

  // A set of columns that form a composite key ('quasi-identifiers')
  // const quasiIds = [{ name: 'age' }, { name: 'city' }];
  async function kAnonymityAnalysis() {
    const sourceTable = {
      projectId: tableProjectId,
      datasetId: datasetId,
      tableId: tableId,
    };
    // Construct request for creating a risk analysis job
    console.log(quasiIds);

    const request = {
      parent: `projects/${projectId}/locations/global`,
      riskJob: {
        privacyMetric: {
          kAnonymityConfig: {
            quasiIds: quasiIds,
          },
        },
        sourceTable: sourceTable,
        actions: [
          {
            pubSub: {
              topic: `projects/${projectId}/topics/${topicId}`,
            },
          },
        ],
      },
    };

    // Create helper function for unpacking values
    const getValue = obj => obj[Object.keys(obj)[0]];

    // Run risk analysis job
    const [topicResponse] = await pubsub.topic(topicId).get();
    const subscription = await topicResponse.subscription(subscriptionId);
    const [jobsResponse] = await dlp.createDlpJob(request);
    const jobName = jobsResponse.name;
    // Watch the Pub/Sub topic until the DLP job finishes
    await new Promise((resolve, reject) => {
      const messageHandler = message => {
        if (message.attributes && message.attributes.DlpJobName === jobName) {
          message.ack();
          subscription.removeListener('message', messageHandler);
          subscription.removeListener('error', errorHandler);
          resolve(jobName);
        } else {
          message.nack();
        }
      };

      const errorHandler = err => {
        subscription.removeListener('message', messageHandler);
        subscription.removeListener('error', errorHandler);
        reject(err);
      };

      subscription.on('message', messageHandler);
      subscription.on('error', errorHandler);
    });
    setTimeout(() => {
      console.log(' Waiting for DLP job to fully complete');
    }, 500);
    const [job] = await dlp.getDlpJob({name: jobName});
    const histogramBuckets =
      job.riskDetails.kAnonymityResult.equivalenceClassHistogramBuckets;

    histogramBuckets.forEach((histogramBucket, histogramBucketIdx) => {
      console.log(`Bucket ${histogramBucketIdx}:`);
      console.log(
        `  Bucket size range: [${histogramBucket.equivalenceClassSizeLowerBound}, ${histogramBucket.equivalenceClassSizeUpperBound}]`
      );

      histogramBucket.bucketValues.forEach(valueBucket => {
        const quasiIdValues = valueBucket.quasiIdsValues
          .map(getValue)
          .join(', ');
        console.log(`  Quasi-ID values: {${quasiIdValues}}`);
        console.log(`  Class size: ${valueBucket.equivalenceClassSize}`);
      });
    });
  }
  kAnonymityAnalysis();
  // [END dlp_k_anonymity]
}

main(...process.argv.slice(2));
process.on('unhandledRejection', err => {
  console.error(err.message);
  process.exitCode = 1;
});

function transformCLI(quasiIds) {
  quasiIds = quasiIds? quasiIds.split(',').map((name, idx) => {
    return {
      field: {
        name: name,
      },
      infoType: {
        name: idx,
      },
    };
  }) : undefined;

  if (quasiIds.infoType && quasiIds.field) {
  if (quasiIds.infoType.length !== quasiIds.field.length) {
    console.error(
      'Number of infoTypes and number of quasi-identifiers must be equal!'
    );
    process.exitCode = 1;
  } 
  }
  return quasiIds;
}