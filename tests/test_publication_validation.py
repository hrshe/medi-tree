import unittest
from tree_validation import publication_errors

class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tree = dict(rootNodeId='a', nodes=[dict(id=k,type=t,position=dict(x=0,y=0)) for k,t in [('a','question'),('b','outcome')]], edges=[dict(source='a',target='b',label='Yes')])
    def test_valid(self):
        self.assertEqual(publication_errors(self.tree), [])
    def test_cycle(self):
        self.tree['edges'].append(dict(source='b',target='a',label='Again'))
        self.assertTrue(any('cycle' in e for e in publication_errors(self.tree)))
    def test_unreachable(self):
        self.tree['edges'].clear()
        self.assertTrue(any('Unreachable' in e for e in publication_errors(self.tree)))
    def test_duplicate(self):
        self.tree['edges'].append(dict(source='a',target='b',label=' yes '))
        self.assertTrue(any('duplicate' in e for e in publication_errors(self.tree)))
    def test_nonfinite(self):
        self.tree['nodes'][0]['position']['x'] = float('inf')
        self.assertTrue(any('non-finite' in e for e in publication_errors(self.tree)))
