# PR#84 TODO

- [x] Return List
- [x] Support
  - [x] deployment
  - [x] services
  - [x] pvc
  - [x] ingress
  - [ ] config maps
- [x] Investigate minishift issue
- [x] Add `deployment.spec.template.metadata` metadata name and labels can be useful and should be added
- [x] projects should be before components
- [x] fix projects flag
- [ ] Better type check
- [ ] Find a better way to generate devfile
- [ ] complete devfile/generate.test.ts
  - [ ] make `nock` work
  - [ ] parse yam. output and verifies, for each kind, items num and fields that shoudl exist and those that should not

```bash
# Create a PROD namespace and set it as default
kubectl create namespace prod
kubens prod

# Start the sample app
# kubectl apply -f https://k8s.io/examples/application/guestbook/redis-master-deployment.yaml
# kubectl apply -f https://k8s.io/examples/application/guestbook/redis-master-service.yaml
# kubectl apply -f https://k8s.io/examples/application/guestbook/redis-slave-deployment.yaml
# kubectl apply -f https://k8s.io/examples/application/guestbook/redis-slave-service.yaml
# kubectl apply -f https://k8s.io/examples/application/guestbook/frontend-deployment.yaml
# kubectl apply -f https://k8s.io/examples/application/guestbook/frontend-service.yaml
# minikube service frontend --url
kubectl apply -f https://raw.githubusercontent.com/sleshchenko/NodeJS-Sample-App/dockerCon/deploy_k8s.yaml

# Run chectl
# chectl devfile:generate \
#            --selector="app=guestbook" \
#            --language=java \
#            --project='{"name": "guestbook", "source": "https://github.com/kubernetes/examples.git"}'

chectl devfile:generate \
           --selector="app.kubernetes.io/name=employee-manager" \
           --language=typescript \
           --git-repo='https://github.com/sleshchenko/NodeJS-Sample-App.git'

# Or run the test
yarn test --coverage=false --testRegex=/test/commands/devfile/generate.test.ts

# Clean
kubectl delete services --all -n prod
kubectl delete deployment --all -n prod
```